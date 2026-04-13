use async_openai::{
    config::OpenAIConfig,
    types::chat::{
        ChatCompletionMessageToolCall, ChatCompletionMessageToolCalls,
        ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestMessage,
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestToolMessageArgs,
        ChatCompletionRequestUserMessageArgs, ChatCompletionTool, ChatCompletionTools,
        CreateChatCompletionRequestArgs, CreateChatCompletionResponse, FunctionCall,
        FunctionObject,
    },
    Client,
};

use super::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageContent, MessageRole,
    StopReason, ToolCall,
};

/// Parse a raw OpenAI chat completion HTTP response into the provider-agnostic
/// [`CompletionResponse`]. Extracted as a free function so it can be unit-tested
/// without standing up an HTTP server.
fn parse_completion(
    response: CreateChatCompletionResponse,
) -> Result<CompletionResponse, LlmError> {
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
        Some(async_openai::types::chat::FinishReason::Stop) => StopReason::EndTurn,
        Some(async_openai::types::chat::FinishReason::ToolCalls) => StopReason::ToolUse,
        // Legacy finish_reason used by older/alternative providers (e.g. Ollama, older Azure).
        // Map to ToolUse so the agent loop dispatches the accompanying function_call payload.
        Some(async_openai::types::chat::FinishReason::FunctionCall) => StopReason::ToolUse,
        Some(async_openai::types::chat::FinishReason::Length) => StopReason::MaxTokens,
        Some(other) => StopReason::Other(format!("{other:?}")),
        None => StopReason::Other("none".to_string()),
    };

    let content = choice.message.content.filter(|s| !s.is_empty());

    // Extract the legacy function_call field before other fields are moved.
    // Older/alternative providers (e.g. Ollama, older Azure) may populate this
    // instead of tool_calls when finish_reason is "function_call".
    #[allow(deprecated)]
    let legacy_function_call = choice.message.function_call;

    let mut tool_calls = choice
        .message
        .tool_calls
        .unwrap_or_default()
        .into_iter()
        .filter_map(|tc| match tc {
            ChatCompletionMessageToolCalls::Function(f) => Some(f),
            other => {
                tracing::warn!("dropping unsupported tool call variant: {:?}", other);
                None
            }
        })
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
    if tool_calls.is_empty() {
        if let Some(fc) = legacy_function_call {
            let arguments = serde_json::from_str(&fc.arguments).map_err(|e| {
                LlmError::ToolCallParsing(format!("function_call '{}': {}", fc.name, e))
            })?;
            tool_calls.push(ToolCall {
                id: "function_call_0".to_string(),
                name: fc.name,
                arguments,
            });
        }
    }

    Ok(CompletionResponse {
        content,
        tool_calls,
        stop_reason,
        usage,
    })
}

pub struct OpenAiCompatibleProvider {
    client: Client<OpenAIConfig>,
    model: String,
}

impl OpenAiCompatibleProvider {
    pub fn new(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        let config = OpenAIConfig::new()
            .with_api_base(base_url.into())
            .with_api_key(api_key.into());
        let client = Client::with_config(config);
        Self {
            client,
            model: model.into(),
        }
    }
}

#[async_trait::async_trait]
impl LlmProvider for OpenAiCompatibleProvider {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, LlmError> {
        // Build message list: system prompt first, then conversation messages.
        let mut messages: Vec<ChatCompletionRequestMessage> = Vec::new();

        messages.push(
            ChatCompletionRequestSystemMessageArgs::default()
                .content(request.system)
                .build()
                .map_err(|e| LlmError::Configuration(e.to_string()))?
                .into(),
        );

        for msg in request.messages {
            match msg.role {
                MessageRole::User => {
                    let text = match msg.content {
                        MessageContent::Text(t) => t,
                        MessageContent::ToolResults(_) => {
                            unreachable!("User role should never carry ToolResults content")
                        }
                    };
                    messages.push(
                        ChatCompletionRequestUserMessageArgs::default()
                            .content(text)
                            .build()
                            .map_err(|e| LlmError::Configuration(e.to_string()))?
                            .into(),
                    );
                }
                MessageRole::Assistant => {
                    let text = match msg.content {
                        MessageContent::Text(t) => t,
                        MessageContent::ToolResults(_) => {
                            unreachable!("Assistant role should never carry ToolResults content")
                        }
                    };
                    let mut builder = ChatCompletionRequestAssistantMessageArgs::default();
                    if !text.is_empty() {
                        builder.content(text);
                    }
                    if !msg.tool_calls.is_empty() {
                        // OpenAI requires the assistant's tool calls to be echoed back
                        // so that the following tool-result messages are understood.
                        let oai_calls: Vec<ChatCompletionMessageToolCalls> = msg
                            .tool_calls
                            .into_iter()
                            .map(|tc| {
                                ChatCompletionMessageToolCalls::Function(
                                    ChatCompletionMessageToolCall {
                                        id: tc.id,
                                        function: FunctionCall {
                                            name: tc.name,
                                            arguments: tc.arguments.to_string(),
                                        },
                                    },
                                )
                            })
                            .collect();
                        builder.tool_calls(oai_calls);
                    }
                    messages.push(
                        builder
                            .build()
                            .map_err(|e| LlmError::Configuration(e.to_string()))?
                            .into(),
                    );
                }
                // OpenAI expects one tool message per result, each with its
                // own tool_call_id. All results from one assistant turn are
                // consecutive messages with role "tool".
                MessageRole::Tool => {
                    if let MessageContent::ToolResults(parts) = msg.content {
                        for part in parts {
                            messages.push(
                                ChatCompletionRequestToolMessageArgs::default()
                                    .tool_call_id(part.tool_call_id)
                                    .content(part.content)
                                    .build()
                                    .map_err(|e| LlmError::Configuration(e.to_string()))?
                                    .into(),
                            );
                        }
                    }
                }
            }
        }

        // Build tool definitions.
        let tools: Vec<ChatCompletionTools> = request
            .tools
            .into_iter()
            .map(|t| {
                ChatCompletionTools::Function(ChatCompletionTool {
                    function: FunctionObject {
                        name: t.name,
                        description: Some(t.description),
                        parameters: Some(t.schema),
                        strict: None,
                    },
                })
            })
            .collect();

        let mut req_builder = CreateChatCompletionRequestArgs::default();
        req_builder
            .model(&self.model)
            .messages(messages)
            .max_completion_tokens(request.max_tokens);

        if !tools.is_empty() {
            req_builder.tools(tools);
        }

        let oai_request = req_builder
            .build()
            .map_err(|e| LlmError::Configuration(e.to_string()))?;

        let response = self
            .client
            .chat()
            .create(oai_request)
            .await
            .map_err(|e| match e {
                async_openai::error::OpenAIError::ApiError(ae) => LlmError::Api {
                    // HTTP status is not preserved in OpenAIError::ApiError
                    status: 0,
                    message: ae.to_string(),
                },
                other => LlmError::Http(other.to_string()),
            })?;

        parse_completion(response)
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
    use async_openai::types::chat::{
        ChatChoice, ChatCompletionResponseMessage, FinishReason, Role,
    };

    fn make_response(
        finish_reason: FinishReason,
        message: ChatCompletionResponseMessage,
    ) -> CreateChatCompletionResponse {
        #[allow(deprecated)]
        CreateChatCompletionResponse {
            id: "test".to_string(),
            choices: vec![ChatChoice {
                index: 0,
                message,
                finish_reason: Some(finish_reason),
                logprobs: None,
            }],
            created: 0,
            model: "test-model".to_string(),
            service_tier: None,
            system_fingerprint: None,
            object: "chat.completion".to_string(),
            usage: None,
        }
    }

    #[test]
    fn function_call_finish_reason_maps_to_tool_use() {
        #[allow(deprecated)]
        let message = ChatCompletionResponseMessage {
            content: None,
            refusal: None,
            tool_calls: None,
            annotations: None,
            role: Role::Assistant,
            function_call: Some(FunctionCall {
                name: "get_weather".to_string(),
                arguments: r#"{"city":"London"}"#.to_string(),
            }),
            audio: None,
        };
        let response = make_response(FinishReason::FunctionCall, message);
        let result = parse_completion(response).expect("parse should succeed");

        assert_eq!(result.stop_reason, StopReason::ToolUse);
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "function_call_0");
        assert_eq!(result.tool_calls[0].name, "get_weather");
        assert_eq!(result.tool_calls[0].arguments["city"], "London");
    }

    #[test]
    fn tool_calls_finish_reason_is_unaffected() {
        #[allow(deprecated)]
        let message = ChatCompletionResponseMessage {
            content: None,
            refusal: None,
            tool_calls: Some(vec![ChatCompletionMessageToolCalls::Function(
                ChatCompletionMessageToolCall {
                    id: "call_abc".to_string(),
                    function: FunctionCall {
                        name: "do_thing".to_string(),
                        arguments: r#"{"x":1}"#.to_string(),
                    },
                },
            )]),
            annotations: None,
            role: Role::Assistant,
            function_call: None,
            audio: None,
        };
        let response = make_response(FinishReason::ToolCalls, message);
        let result = parse_completion(response).expect("parse should succeed");

        assert_eq!(result.stop_reason, StopReason::ToolUse);
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "call_abc");
        assert_eq!(result.tool_calls[0].name, "do_thing");
    }

    #[test]
    fn stop_finish_reason_maps_to_end_turn() {
        #[allow(deprecated)]
        let message = ChatCompletionResponseMessage {
            content: Some("hello".to_string()),
            refusal: None,
            tool_calls: None,
            annotations: None,
            role: Role::Assistant,
            function_call: None,
            audio: None,
        };
        let response = make_response(FinishReason::Stop, message);
        let result = parse_completion(response).expect("parse should succeed");

        assert_eq!(result.stop_reason, StopReason::EndTurn);
        assert!(result.tool_calls.is_empty());
        assert_eq!(result.content.as_deref(), Some("hello"));
    }
}
