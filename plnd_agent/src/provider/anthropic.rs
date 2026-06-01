use serde::{Deserialize, Serialize};

use super::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageContent, MessageRole,
    StopReason, ToolCall,
};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
const MAX_RETRIES: u32 = 3;

pub struct AnthropicProvider {
    http: reqwest::Client,
    api_key: String,
    model: String,
    base_url: String,
    api_version: Option<String>,
}

impl AnthropicProvider {
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key: api_key.into(),
            model: model.into(),
            base_url: DEFAULT_BASE_URL.to_string(),
            api_version: None,
        }
    }

    /// Override the base URL for compatible Anthropic API proxies.
    /// Note: AWS Bedrock uses a different request envelope and auth model — not supported here.
    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into();
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
    system: &'a str,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<AnthropicToolDef<'a>>,
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
    #[allow(dead_code)] // present in API response for completeness; not used in token mapping
    cache_creation_input_tokens: u32,
}

impl AnthropicUsage {
    fn to_token_usage(&self) -> super::TokenUsage {
        let prompt_tokens = self.input_tokens + self.cache_read_input_tokens;
        super::TokenUsage {
            prompt_tokens,
            completion_tokens: self.output_tokens,
            total_tokens: prompt_tokens + self.output_tokens,
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

// ── Retry policy ─────────────────────────────────────────────────────────────

/// Returns how long to wait (ms) before retrying a failed request, or `None`
/// if the status code is not retriable.
///
/// Retriable: 429 (rate limit) and 529 (Anthropic overload).
/// Priority: `retry-after-ms` header → `retry-after` (seconds) → exponential
/// backoff starting at 1 s, doubling each attempt, capped at 8 s.
fn retry_delay_ms(status: u16, headers: &reqwest::header::HeaderMap, attempt: u32) -> Option<u64> {
    if status != 429 && status != 529 {
        return None;
    }
    if let Some(ms) = headers
        .get("retry-after-ms")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
    {
        return Some(ms);
    }
    if let Some(secs) = headers
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
    {
        return Some(secs * 1_000);
    }
    // Exponential backoff: 1 s, 2 s, 4 s, capped at 8 s.
    Some(1_000 * (1u64 << attempt.min(3)))
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

    /// Send one HTTP request to the Anthropic messages endpoint.
    async fn send_request(
        &self,
        request: &CompletionRequest,
    ) -> Result<reqwest::Response, LlmError> {
        let messages = Self::build_messages(request);
        let tools: Vec<AnthropicToolDef<'_>> = request
            .tools
            .iter()
            .map(|t| AnthropicToolDef {
                name: &t.name,
                description: &t.description,
                input_schema: &t.schema,
            })
            .collect();
        let body = AnthropicRequest {
            model: &self.model,
            max_tokens: request.max_tokens,
            system: &request.system,
            messages,
            tools,
        };
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
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, LlmError> {
        for attempt in 0..=MAX_RETRIES {
            let http_response = self.send_request(&request).await?;

            if http_response.status().is_success() {
                return Self::parse_response(http_response).await;
            }

            let status = http_response.status().as_u16();
            let headers = http_response.headers().clone();
            let message = http_response
                .text()
                .await
                .unwrap_or_else(|_| "(unreadable body)".to_string());

            if let Some(delay_ms) = retry_delay_ms(status, &headers, attempt)
                && attempt < MAX_RETRIES
            {
                tracing::warn!(
                    attempt,
                    status,
                    delay_ms,
                    "LLM rate limit or overload; retrying after delay"
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                continue;
            }

            return Err(LlmError::Api { status, message });
        }
        unreachable!()
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

    // ── retry_delay_ms ────────────────────────────────────────────────────────

    #[test]
    fn retry_delay_ms_returns_none_for_non_retriable_status() {
        let headers = reqwest::header::HeaderMap::new();
        assert_eq!(retry_delay_ms(200, &headers, 0), None);
        assert_eq!(retry_delay_ms(400, &headers, 0), None);
        assert_eq!(retry_delay_ms(500, &headers, 0), None);
        assert_eq!(retry_delay_ms(503, &headers, 0), None);
    }

    #[test]
    fn retry_delay_ms_uses_retry_after_ms_header_on_429() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("retry-after-ms", "2500".parse().unwrap());
        assert_eq!(retry_delay_ms(429, &headers, 0), Some(2500));
    }

    #[test]
    fn retry_delay_ms_converts_retry_after_seconds_to_ms_on_429() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("retry-after", "3".parse().unwrap());
        assert_eq!(retry_delay_ms(429, &headers, 0), Some(3000));
    }

    #[test]
    fn retry_delay_ms_prefers_ms_header_over_seconds_header() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("retry-after-ms", "1500".parse().unwrap());
        headers.insert("retry-after", "10".parse().unwrap());
        assert_eq!(retry_delay_ms(429, &headers, 0), Some(1500));
    }

    #[test]
    fn retry_delay_ms_exponential_backoff_when_no_header() {
        let headers = reqwest::header::HeaderMap::new();
        assert_eq!(retry_delay_ms(429, &headers, 0), Some(1_000));
        assert_eq!(retry_delay_ms(429, &headers, 1), Some(2_000));
        assert_eq!(retry_delay_ms(429, &headers, 2), Some(4_000));
    }

    #[test]
    fn retry_delay_ms_caps_backoff_at_eight_seconds() {
        let headers = reqwest::header::HeaderMap::new();
        assert_eq!(retry_delay_ms(429, &headers, 3), Some(8_000));
        assert_eq!(retry_delay_ms(429, &headers, 99), Some(8_000));
    }

    #[test]
    fn retry_delay_ms_applies_to_529_overload() {
        let headers = reqwest::header::HeaderMap::new();
        assert_eq!(retry_delay_ms(529, &headers, 0), Some(1_000));
    }

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
        // input_tokens (100) already includes cache_creation (20); only cache_read (30) is additive
        assert_eq!(token_usage.prompt_tokens, 130);
        assert_eq!(token_usage.completion_tokens, 50);
        assert_eq!(token_usage.total_tokens, 180);
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
        assert_eq!(t.prompt_tokens, 130); // input_tokens (100) + cache_read (30)
        assert_eq!(t.completion_tokens, 50);
        assert_eq!(t.total_tokens, 180);
        assert_eq!(t.prompt_tokens + t.completion_tokens, t.total_tokens);
    }

    #[test]
    fn usage_missing_cache_fields_default_to_zero() {
        let json = r#"{"input_tokens":10,"output_tokens":5}"#;
        let usage: AnthropicUsage = serde_json::from_str(json).unwrap();
        assert_eq!(usage.cache_read_input_tokens, 0);
        assert_eq!(usage.cache_creation_input_tokens, 0);
    }
}
