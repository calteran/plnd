use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::{
    Completion, CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageContent,
    MessageRole, StopReason, ToolCall, resolve_retry_sleep, retry_delay,
};

/// Default total backoff budget for rate-limit (429) / overload (529) retries.
const DEFAULT_MAX_RETRY_WAIT: Duration = Duration::from_secs(300);

// ── Request wire types ────────────────────────────────────────────────────────

#[derive(Serialize)]
struct OaiRequest {
    model: String,
    messages: Vec<OaiReqMsg>,
    max_completion_tokens: u32,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<OaiToolDef>,
}

/// Internally tagged on "role" — matches OpenAI's chat completion wire format.
#[derive(Serialize)]
#[serde(tag = "role", rename_all = "lowercase")]
enum OaiReqMsg {
    System {
        content: String,
    },
    User {
        content: String,
    },
    Assistant {
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        tool_calls: Vec<OaiReqToolCall>,
    },
    Tool {
        content: String,
        tool_call_id: String,
    },
}

#[derive(Serialize)]
struct OaiReqToolCall {
    id: String,
    #[serde(rename = "type")]
    kind: String, // always "function"
    function: OaiFnBody,
}

/// Shared function body for outgoing tool_calls and incoming function_call.
#[derive(Serialize, Deserialize)]
struct OaiFnBody {
    name: String,
    arguments: String, // JSON-serialized
}

#[derive(Serialize)]
struct OaiToolDef {
    #[serde(rename = "type")]
    kind: String, // always "function"
    function: OaiFnDef,
}

#[derive(Serialize)]
struct OaiFnDef {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

// ── Response wire types ───────────────────────────────────────────────────────

#[derive(Deserialize)]
struct OaiResponse {
    choices: Vec<OaiChoice>,
    usage: Option<OaiUsage>,
}

#[derive(Deserialize)]
struct OaiChoice {
    finish_reason: Option<OaiFinishReason>,
    message: OaiRespMsg,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum OaiFinishReason {
    Stop,
    ToolCalls,
    FunctionCall,
    Length,
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct OaiRespMsg {
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<OaiRespToolCall>,
    /// Legacy field populated by older/alternative providers (e.g. Ollama, older Azure).
    function_call: Option<OaiFnBody>,
}

#[derive(Deserialize)]
struct OaiRespToolCall {
    id: String,
    function: OaiFnBody,
}

#[derive(Deserialize)]
struct OaiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

// ── Response parsing ──────────────────────────────────────────────────────────

/// Parse a raw OpenAI chat completion response into the provider-agnostic
/// [`CompletionResponse`]. Extracted as a free function so it can be unit-tested
/// without standing up an HTTP server.
fn parse_completion(response: OaiResponse) -> Result<CompletionResponse, LlmError> {
    let usage = response.usage.map(|u| super::TokenUsage {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
    });

    let choice = response
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| LlmError::Api {
            status: 200,
            message: "Provider returned no choices".to_string(),
        })?;

    let stop_reason = match choice.finish_reason {
        Some(OaiFinishReason::Stop) => StopReason::EndTurn,
        Some(OaiFinishReason::ToolCalls) => StopReason::ToolUse,
        // Legacy finish_reason used by older/alternative providers (e.g. Ollama, older Azure).
        // Map to ToolUse so the agent loop dispatches the accompanying function_call payload.
        Some(OaiFinishReason::FunctionCall) => StopReason::ToolUse,
        Some(OaiFinishReason::Length) => StopReason::MaxTokens,
        Some(OaiFinishReason::Other) | None => StopReason::Other("other".to_string()),
    };

    let content = choice.message.content.filter(|s| !s.is_empty());

    let mut tool_calls = choice
        .message
        .tool_calls
        .into_iter()
        .map(|tc| {
            let arguments = serde_json::from_str(&tc.function.arguments).map_err(|e| {
                LlmError::ToolCallParsing(format!("tool '{}': {}", tc.function.name, e))
            })?;
            Ok(ToolCall {
                id: tc.id,
                name: tc.function.name,
                arguments,
            })
        })
        .collect::<Result<Vec<_>, LlmError>>()?;

    // Fall back to the legacy function_call field when tool_calls is empty.
    // The legacy API carries no call ID, so we synthesise a stable placeholder.
    if tool_calls.is_empty()
        && let Some(fc) = choice.message.function_call
    {
        let arguments = serde_json::from_str(&fc.arguments).map_err(|e| {
            LlmError::ToolCallParsing(format!("function_call '{}': {}", fc.name, e))
        })?;
        tool_calls.push(ToolCall {
            id: "function_call_0".to_string(),
            name: fc.name,
            arguments,
        });
    }

    Ok(CompletionResponse {
        content,
        tool_calls,
        stop_reason,
        usage,
    })
}

// ── Provider ──────────────────────────────────────────────────────────────────

pub struct OpenAiCompatibleProvider {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
    model: String,
    /// Cumulative wall-clock budget for retrying 429/529 responses before the
    /// request is failed. See [`OpenAiCompatibleProvider::with_max_retry_wait`].
    max_retry_wait: Duration,
}

impl OpenAiCompatibleProvider {
    pub fn new(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            http: reqwest::Client::new(),
            api_key: api_key.into(),
            base_url: base_url.into(),
            model: model.into(),
            max_retry_wait: DEFAULT_MAX_RETRY_WAIT,
        }
    }

    /// Override the total backoff budget for rate-limit / overload retries.
    pub fn with_max_retry_wait(mut self, wait: Duration) -> Self {
        self.max_retry_wait = wait;
        self
    }
}

#[async_trait::async_trait]
impl LlmProvider for OpenAiCompatibleProvider {
    async fn complete(&self, request: CompletionRequest) -> Result<Completion, LlmError> {
        let mut messages: Vec<OaiReqMsg> = Vec::new();

        messages.push(OaiReqMsg::System {
            content: request.system,
        });

        for msg in request.messages {
            match msg.role {
                MessageRole::User => {
                    let text = match msg.content {
                        MessageContent::Text(t) => t,
                        MessageContent::ToolResults(_) => {
                            unreachable!("User role should never carry ToolResults content")
                        }
                    };
                    messages.push(OaiReqMsg::User { content: text });
                }
                MessageRole::Assistant => {
                    let text = match msg.content {
                        MessageContent::Text(t) => t,
                        MessageContent::ToolResults(_) => {
                            unreachable!("Assistant role should never carry ToolResults content")
                        }
                    };
                    // OpenAI requires the assistant's tool calls to be echoed back
                    // so that the following tool-result messages are understood.
                    let tool_calls = msg
                        .tool_calls
                        .into_iter()
                        .map(|tc| OaiReqToolCall {
                            id: tc.id,
                            kind: "function".to_string(),
                            function: OaiFnBody {
                                name: tc.name,
                                arguments: tc.arguments.to_string(),
                            },
                        })
                        .collect();
                    messages.push(OaiReqMsg::Assistant {
                        content: if text.is_empty() { None } else { Some(text) },
                        tool_calls,
                    });
                }
                // OpenAI expects one tool message per result, each with its
                // own tool_call_id. All results from one assistant turn are
                // consecutive messages with role "tool".
                MessageRole::Tool => {
                    if let MessageContent::ToolResults(parts) = msg.content {
                        for part in parts {
                            messages.push(OaiReqMsg::Tool {
                                content: part.content,
                                tool_call_id: part.tool_call_id,
                            });
                        }
                    }
                }
            }
        }

        let tools = request
            .tools
            .into_iter()
            .map(|t| OaiToolDef {
                kind: "function".to_string(),
                function: OaiFnDef {
                    name: t.name,
                    description: t.description,
                    parameters: t.schema,
                },
            })
            .collect();

        let body = OaiRequest {
            model: self.model.clone(),
            messages,
            max_completion_tokens: request.max_tokens,
            tools,
        };

        let url = format!("{}/chat/completions", self.base_url);

        // Retry 429/529 with jittered backoff until the cumulative wait would
        // exceed the configured budget, then fail. Mirrors the Anthropic
        // provider's policy. `body` is reused verbatim across attempts.
        let started = Instant::now();
        let mut attempt: u32 = 0;
        let mut rate_limited = false;
        let http_response = loop {
            let http_response = self
                .http
                .post(&url)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .json(&body)
                .send()
                .await?;

            if http_response.status().is_success() {
                break http_response;
            }

            let status = http_response.status().as_u16();
            let headers = http_response.headers().clone();

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
        };

        let parsed: OaiResponse = http_response
            .json()
            .await
            .map_err(|e| LlmError::Deserialization(e.to_string()))?;

        parse_completion(parsed).map(|response| Completion {
            response,
            rate_limited,
        })
    }

    fn name(&self) -> &str {
        "openai_compatible"
    }

    fn model(&self) -> &str {
        &self.model
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_response(finish_reason: OaiFinishReason, message: OaiRespMsg) -> OaiResponse {
        OaiResponse {
            choices: vec![OaiChoice {
                finish_reason: Some(finish_reason),
                message,
            }],
            usage: None,
        }
    }

    #[test]
    fn function_call_finish_reason_maps_to_tool_use() {
        let message = OaiRespMsg {
            content: None,
            tool_calls: vec![],
            function_call: Some(OaiFnBody {
                name: "get_weather".to_string(),
                arguments: r#"{"city":"London"}"#.to_string(),
            }),
        };
        let response = make_response(OaiFinishReason::FunctionCall, message);
        let result = parse_completion(response).expect("parse should succeed");

        assert_eq!(result.stop_reason, StopReason::ToolUse);
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "function_call_0");
        assert_eq!(result.tool_calls[0].name, "get_weather");
        assert_eq!(result.tool_calls[0].arguments["city"], "London");
    }

    #[test]
    fn tool_calls_finish_reason_is_unaffected() {
        let message = OaiRespMsg {
            content: None,
            tool_calls: vec![OaiRespToolCall {
                id: "call_abc".to_string(),
                function: OaiFnBody {
                    name: "do_thing".to_string(),
                    arguments: r#"{"x":1}"#.to_string(),
                },
            }],
            function_call: None,
        };
        let response = make_response(OaiFinishReason::ToolCalls, message);
        let result = parse_completion(response).expect("parse should succeed");

        assert_eq!(result.stop_reason, StopReason::ToolUse);
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "call_abc");
        assert_eq!(result.tool_calls[0].name, "do_thing");
    }

    #[test]
    fn stop_finish_reason_maps_to_end_turn() {
        let message = OaiRespMsg {
            content: Some("hello".to_string()),
            tool_calls: vec![],
            function_call: None,
        };
        let response = make_response(OaiFinishReason::Stop, message);
        let result = parse_completion(response).expect("parse should succeed");

        assert_eq!(result.stop_reason, StopReason::EndTurn);
        assert!(result.tool_calls.is_empty());
        assert_eq!(result.content.as_deref(), Some("hello"));
    }
}
