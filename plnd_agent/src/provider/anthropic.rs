use serde::{Deserialize, Serialize};

use super::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageContent, MessageRole,
    StopReason, ToolCall,
};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";

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
    cache_creation_input_tokens: u32,
}

impl AnthropicUsage {
    fn to_token_usage(&self) -> super::TokenUsage {
        let prompt_tokens = self.input_tokens
            + self.cache_read_input_tokens
            + self.cache_creation_input_tokens;
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

// ── LlmProvider impl ─────────────────────────────────────────────────────────

#[async_trait::async_trait]
impl LlmProvider for AnthropicProvider {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, LlmError> {
        let messages: Vec<AnthropicMessage> = request
            .messages
            .into_iter()
            .map(|m| match m.role {
                MessageRole::User => AnthropicMessage {
                    role: "user",
                    content: match m.content {
                        MessageContent::Text(t) => AnthropicMessageContent::Text(t),
                        MessageContent::ToolResults(_) => {
                            unreachable!("User role should never carry ToolResults content")
                        }
                    },
                },
                MessageRole::Assistant => {
                    let text = match m.content {
                        MessageContent::Text(t) => t,
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
                        for tc in m.tool_calls {
                            blocks.push(AnthropicBlock::ToolUse {
                                id: tc.id,
                                name: tc.name,
                                input: tc.arguments,
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
                    content: match m.content {
                        MessageContent::ToolResults(parts) => AnthropicMessageContent::Blocks(
                            parts
                                .into_iter()
                                .map(|p| AnthropicBlock::ToolResult {
                                    tool_use_id: p.tool_call_id,
                                    content: p.content,
                                })
                                .collect(),
                        ),
                        MessageContent::Text(t) => AnthropicMessageContent::Text(t),
                    },
                },
            })
            .collect();

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
        let http_response = self
            .http
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header(
                "anthropic-version",
                self.api_version.as_deref().unwrap_or(ANTHROPIC_VERSION),
            )
            .json(&body)
            .send()
            .await?;

        if !http_response.status().is_success() {
            let status = http_response.status().as_u16();
            let message = http_response
                .text()
                .await
                .unwrap_or_else(|_| "(unreadable body)".to_string());
            return Err(LlmError::Api { status, message });
        }

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
        let content = if accumulated.is_empty() {
            None
        } else {
            Some(accumulated)
        };

        Ok(CompletionResponse {
            content,
            tool_calls,
            stop_reason,
            usage: Some(parsed.usage.to_token_usage()),
        })
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

    fn make_usage(
        input: u32,
        output: u32,
        cache_read: u32,
        cache_creation: u32,
    ) -> AnthropicUsage {
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
}
