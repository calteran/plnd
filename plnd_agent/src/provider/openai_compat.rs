use async_openai::{
    config::OpenAIConfig,
    types::chat::{
        ChatCompletionMessageToolCall, ChatCompletionMessageToolCalls,
        ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestMessage,
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestToolMessageArgs,
        ChatCompletionRequestUserMessageArgs, ChatCompletionTool, ChatCompletionTools,
        CreateChatCompletionRequestArgs, FunctionCall, FunctionObject,
    },
    Client,
};

use super::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageContent, MessageRole,
    StopReason, ToolCall,
};

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
            Some(async_openai::types::chat::FinishReason::Length) => StopReason::MaxTokens,
            Some(other) => StopReason::Other(format!("{other:?}")),
            None => StopReason::Other("none".to_string()),
        };

        let content = choice.message.content.filter(|s| !s.is_empty());

        let tool_calls = choice
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

        Ok(CompletionResponse {
            content,
            tool_calls,
            stop_reason,
        })
    }

    fn name(&self) -> &str {
        "openai_compatible"
    }
}
