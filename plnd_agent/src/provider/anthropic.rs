use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::{
    Completion, CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageContent,
    MessageRole, StopReason, ToolCall, resolve_retry_sleep, retry_delay,
};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";

/// Default total backoff budget for rate-limit (429) / overload (529) retries.
const DEFAULT_MAX_RETRY_WAIT: Duration = Duration::from_secs(300);

pub struct AnthropicProvider {
    http: reqwest::Client,
    api_key: String,
    model: String,
    base_url: String,
    api_version: Option<String>,
    /// Cumulative wall-clock budget for retrying 429/529 responses before the
    /// request is failed. See [`AnthropicProvider::with_max_retry_wait`].
    max_retry_wait: Duration,
}

impl AnthropicProvider {
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key: api_key.into(),
            model: model.into(),
            base_url: DEFAULT_BASE_URL.to_string(),
            api_version: None,
            max_retry_wait: DEFAULT_MAX_RETRY_WAIT,
        }
    }

    /// Override the base URL for compatible Anthropic API proxies.
    /// Note: AWS Bedrock uses a different request envelope and auth model — not supported here.
    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into();
        self
    }

    /// Override the total backoff budget for rate-limit / overload retries.
    pub fn with_max_retry_wait(mut self, wait: Duration) -> Self {
        self.max_retry_wait = wait;
        self
    }

    /// Override the `anthropic-version` header (defaults to `ANTHROPIC_VERSION`).
    pub fn with_api_version(mut self, version: impl Into<String>) -> Self {
        self.api_version = Some(version.into());
        self
    }
}

// ── Private request/response types ───────────────────────────────────────────

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: Vec<AnthropicSystemBlock<'a>>,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<AnthropicToolDef<'a>>,
}

/// A system-prompt content block. Serialized as an array element so a
/// `cache_control` breakpoint can be attached. Anthropic processes the request
/// prefix in tools -> system -> messages order, so one breakpoint here caches
/// the tool definitions and the system prompt together as a single segment.
#[derive(Serialize)]
struct AnthropicSystemBlock<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<CacheControl>,
}

#[derive(Serialize, Clone, Copy)]
struct CacheControl {
    #[serde(rename = "type")]
    kind: &'static str,
}

impl CacheControl {
    const EPHEMERAL: CacheControl = CacheControl { kind: "ephemeral" };
}

/// Outgoing message for the Anthropic wire format. Uses owned types because
/// tool-result turns require allocated content block arrays.
#[derive(Serialize)]
struct AnthropicMessage {
    role: &'static str,
    content: AnthropicMessageContent,
}

/// Anthropic accepts either a plain string or an array of typed content blocks.
#[derive(Serialize)]
#[serde(untagged)]
enum AnthropicMessageContent {
    Text(String),
    Blocks(Vec<AnthropicBlock>),
}

/// A single typed content block in an Anthropic message.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AnthropicBlock {
    Text {
        text: String,
    },
    /// Represents a tool call made by the assistant in a previous turn.
    /// Must be included in the assistant message that precedes `ToolResult` blocks.
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
    },
}

#[derive(Serialize)]
struct AnthropicToolDef<'a> {
    name: &'a str,
    description: &'a str,
    input_schema: &'a serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct AnthropicUsage {
    input_tokens: u32,
    output_tokens: u32,
    #[serde(default)]
    cache_read_input_tokens: u32,
    #[serde(default)]
    cache_creation_input_tokens: u32,
}

impl AnthropicUsage {
    fn to_token_usage(&self) -> super::TokenUsage {
        // input_tokens, cache_read_input_tokens, and cache_creation_input_tokens
        // are disjoint in the Anthropic API; total input is the sum of all three.
        let prompt_tokens =
            self.input_tokens + self.cache_read_input_tokens + self.cache_creation_input_tokens;
        super::TokenUsage {
            prompt_tokens,
            completion_tokens: self.output_tokens,
            total_tokens: prompt_tokens + self.output_tokens,
            cache_read_tokens: self.cache_read_input_tokens,
            cache_creation_tokens: self.cache_creation_input_tokens,
        }
    }
}

#[derive(Deserialize)]
struct AnthropicResponse {
    stop_reason: String,
    content: Vec<AnthropicContentBlock>,
    usage: AnthropicUsage,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum AnthropicContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
}

// ── LlmProvider impl ─────────────────────────────────────────────────────────

impl AnthropicProvider {
    /// Build Anthropic wire-format messages from a [`CompletionRequest`].
    fn build_messages(request: &CompletionRequest) -> Vec<AnthropicMessage> {
        request
            .messages
            .iter()
            .map(|m| match m.role {
                MessageRole::User => AnthropicMessage {
                    role: "user",
                    content: match &m.content {
                        MessageContent::Text(t) => AnthropicMessageContent::Text(t.clone()),
                        MessageContent::ToolResults(_) => {
                            unreachable!("User role should never carry ToolResults content")
                        }
                    },
                },
                MessageRole::Assistant => {
                    let text = match &m.content {
                        MessageContent::Text(t) => t.clone(),
                        MessageContent::ToolResults(_) => {
                            unreachable!("Assistant role should never carry ToolResults content")
                        }
                    };
                    if m.tool_calls.is_empty() {
                        AnthropicMessage {
                            role: "assistant",
                            content: AnthropicMessageContent::Text(text),
                        }
                    } else {
                        // Anthropic requires tool calls to appear as `tool_use`
                        // content blocks in the assistant message so that the
                        // subsequent `tool_result` blocks are understood in context.
                        let mut blocks: Vec<AnthropicBlock> = Vec::new();
                        if !text.is_empty() {
                            blocks.push(AnthropicBlock::Text { text });
                        }
                        for tc in &m.tool_calls {
                            blocks.push(AnthropicBlock::ToolUse {
                                id: tc.id.clone(),
                                name: tc.name.clone(),
                                input: tc.arguments.clone(),
                            });
                        }
                        AnthropicMessage {
                            role: "assistant",
                            content: AnthropicMessageContent::Blocks(blocks),
                        }
                    }
                }
                // Anthropic tool results are submitted as a "user" role message
                // containing an array of tool_result content blocks — one per
                // tool call from the previous assistant turn.
                MessageRole::Tool => AnthropicMessage {
                    role: "user",
                    content: match &m.content {
                        MessageContent::ToolResults(parts) => AnthropicMessageContent::Blocks(
                            parts
                                .iter()
                                .map(|p| AnthropicBlock::ToolResult {
                                    tool_use_id: p.tool_call_id.clone(),
                                    content: p.content.clone(),
                                })
                                .collect(),
                        ),
                        MessageContent::Text(t) => AnthropicMessageContent::Text(t.clone()),
                    },
                },
            })
            .collect()
    }

    /// Build the Anthropic wire-format request body, attaching a single
    /// `cache_control: ephemeral` breakpoint to the system block.
    fn build_body<'a>(&'a self, request: &'a CompletionRequest) -> AnthropicRequest<'a> {
        let messages = Self::build_messages(request);
        let tools: Vec<AnthropicToolDef<'a>> = request
            .tools
            .iter()
            .map(|t| AnthropicToolDef {
                name: &t.name,
                description: &t.description,
                input_schema: &t.schema,
            })
            .collect();
        AnthropicRequest {
            model: &self.model,
            max_tokens: request.max_tokens,
            system: vec![AnthropicSystemBlock {
                kind: "text",
                text: &request.system,
                cache_control: Some(CacheControl::EPHEMERAL),
            }],
            messages,
            tools,
        }
    }

    /// Send one HTTP request to the Anthropic messages endpoint.
    async fn send_request(
        &self,
        request: &CompletionRequest,
    ) -> Result<reqwest::Response, LlmError> {
        let body = self.build_body(request);
        let url = format!("{}/v1/messages", self.base_url);
        Ok(self
            .http
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header(
                "anthropic-version",
                self.api_version.as_deref().unwrap_or(ANTHROPIC_VERSION),
            )
            .json(&body)
            .send()
            .await?)
    }

    /// Parse a successful HTTP response into a [`CompletionResponse`].
    async fn parse_response(
        http_response: reqwest::Response,
    ) -> Result<CompletionResponse, LlmError> {
        let parsed: AnthropicResponse = http_response
            .json()
            .await
            .map_err(|e| LlmError::Deserialization(e.to_string()))?;

        let stop_reason = match parsed.stop_reason.as_str() {
            "end_turn" => StopReason::EndTurn,
            "tool_use" => StopReason::ToolUse,
            "max_tokens" => StopReason::MaxTokens,
            other => StopReason::Other(other.to_string()),
        };

        let mut text_parts: Vec<String> = Vec::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        for block in parsed.content {
            match block {
                AnthropicContentBlock::Text { text } => text_parts.push(text),
                AnthropicContentBlock::ToolUse { id, name, input } => {
                    tool_calls.push(ToolCall {
                        id,
                        name,
                        arguments: input,
                    });
                }
            }
        }
        let accumulated = text_parts.join("");
        Ok(CompletionResponse {
            content: if accumulated.is_empty() {
                None
            } else {
                Some(accumulated)
            },
            tool_calls,
            stop_reason,
            usage: Some(parsed.usage.to_token_usage()),
        })
    }
}

#[async_trait::async_trait]
impl LlmProvider for AnthropicProvider {
    async fn complete(&self, request: CompletionRequest) -> Result<Completion, LlmError> {
        let started = Instant::now();
        let mut attempt: u32 = 0;
        let mut rate_limited = false;
        loop {
            let http_response = self.send_request(&request).await?;

            if http_response.status().is_success() {
                return Self::parse_response(http_response)
                    .await
                    .map(|response| Completion {
                        response,
                        rate_limited,
                    });
            }

            let status = http_response.status().as_u16();
            let headers = http_response.headers().clone();

            // Retry 429/529 with jittered backoff until the cumulative wait would
            // exceed the configured budget, then fail. Server `retry-after` hints
            // are honored verbatim; computed backoff is jittered so concurrent
            // callers do not re-collide in lockstep.
            if let Some(delay) = retry_delay(status, &headers, attempt) {
                let sleep = resolve_retry_sleep(delay);
                if started.elapsed() + sleep <= self.max_retry_wait {
                    rate_limited = true;
                    tracing::warn!(
                        attempt,
                        status,
                        sleep_ms = sleep.as_millis() as u64,
                        elapsed_ms = started.elapsed().as_millis() as u64,
                        "LLM rate limit or overload; retrying after backoff"
                    );
                    tokio::time::sleep(sleep).await;
                    attempt += 1;
                    continue;
                }
                tracing::warn!(
                    attempt,
                    status,
                    elapsed_ms = started.elapsed().as_millis() as u64,
                    "LLM retry budget exhausted; giving up"
                );
            }

            let message = http_response
                .text()
                .await
                .unwrap_or_else(|_| "(unreadable body)".to_string());
            return Err(LlmError::Api { status, message });
        }
    }

    fn name(&self) -> &str {
        "anthropic"
    }

    fn model(&self) -> &str {
        &self.model
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── AnthropicUsage ────────────────────────────────────────────────────────

    fn make_usage(input: u32, output: u32, cache_read: u32, cache_creation: u32) -> AnthropicUsage {
        AnthropicUsage {
            input_tokens: input,
            output_tokens: output,
            cache_read_input_tokens: cache_read,
            cache_creation_input_tokens: cache_creation,
        }
    }

    #[test]
    fn prompt_tokens_includes_cache_tokens() {
        let usage = make_usage(100, 50, 30, 20);
        let token_usage = usage.to_token_usage();
        // input (100), cache_read (30), cache_creation (20) are disjoint -> sum = 150
        assert_eq!(token_usage.prompt_tokens, 150);
        assert_eq!(token_usage.completion_tokens, 50);
        assert_eq!(token_usage.total_tokens, 200);
        assert_eq!(
            token_usage.prompt_tokens + token_usage.completion_tokens,
            token_usage.total_tokens
        );
    }

    #[test]
    fn prompt_tokens_no_cache_unchanged() {
        let usage = make_usage(100, 50, 0, 0);
        let token_usage = usage.to_token_usage();
        assert_eq!(token_usage.prompt_tokens, 100);
        assert_eq!(token_usage.completion_tokens, 50);
        assert_eq!(token_usage.total_tokens, 150);
        assert_eq!(
            token_usage.prompt_tokens + token_usage.completion_tokens,
            token_usage.total_tokens
        );
    }

    #[test]
    fn usage_deserializes_standard_response() {
        let json = r#"{"input_tokens":100,"output_tokens":50}"#;
        let usage: AnthropicUsage = serde_json::from_str(json).unwrap();
        let t = usage.to_token_usage();
        assert_eq!(t.prompt_tokens, 100);
        assert_eq!(t.completion_tokens, 50);
        assert_eq!(t.total_tokens, 150);
    }

    #[test]
    fn usage_deserializes_with_cache_tokens() {
        let json = r#"{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":30,"cache_creation_input_tokens":20}"#;
        let usage: AnthropicUsage = serde_json::from_str(json).unwrap();
        let t = usage.to_token_usage();
        assert_eq!(t.prompt_tokens, 150); // input (100) + cache_read (30) + cache_creation (20)
        assert_eq!(t.completion_tokens, 50);
        assert_eq!(t.total_tokens, 200);
        assert_eq!(t.prompt_tokens + t.completion_tokens, t.total_tokens);
        assert_eq!(t.cache_read_tokens, 30);
        assert_eq!(t.cache_creation_tokens, 20);
    }

    #[test]
    fn usage_missing_cache_fields_default_to_zero() {
        let json = r#"{"input_tokens":10,"output_tokens":5}"#;
        let usage: AnthropicUsage = serde_json::from_str(json).unwrap();
        assert_eq!(usage.cache_read_input_tokens, 0);
        assert_eq!(usage.cache_creation_input_tokens, 0);
    }

    // ── Request body / cache_control ─────────────────────────────────────────

    #[test]
    fn system_block_carries_ephemeral_cache_control() {
        let provider = AnthropicProvider::new("test-key", "claude-test");
        let request = CompletionRequest {
            system: "You are a helpful assistant.".to_string(),
            messages: vec![],
            tools: vec![],
            max_tokens: 256,
        };
        let body = provider.build_body(&request);
        let v = serde_json::to_value(&body).unwrap();

        assert_eq!(v["system"][0]["type"], "text");
        assert_eq!(v["system"][0]["text"], "You are a helpful assistant.");
        assert_eq!(v["system"][0]["cache_control"]["type"], "ephemeral");
    }
}
