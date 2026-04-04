use serde::{Deserialize, Serialize};

use super::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageRole, StopReason, ToolCall,
};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";

pub struct AnthropicProvider {
    http: reqwest::Client,
    api_key: String,
    model: String,
    base_url: String,
}

impl AnthropicProvider {
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key: api_key.into(),
            model: model.into(),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    /// Override the base URL for compatible Anthropic API proxies.
    /// Note: AWS Bedrock uses a different request envelope and auth model — not supported here.
    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into();
        self
    }
}

// ── Private request/response types ───────────────────────────────────────────

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: Vec<AnthropicMessage<'a>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<AnthropicToolDef<'a>>,
}

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct AnthropicToolDef<'a> {
    name: &'a str,
    description: &'a str,
    input_schema: &'a serde_json::Value,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    stop_reason: String,
    content: Vec<AnthropicContentBlock>,
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
        let messages: Vec<AnthropicMessage<'_>> = request
            .messages
            .iter()
            .map(|m| AnthropicMessage {
                role: match m.role {
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                },
                content: &m.content,
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
            .header("anthropic-version", ANTHROPIC_VERSION)
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
        })
    }

    fn name(&self) -> &str {
        "anthropic"
    }
}
