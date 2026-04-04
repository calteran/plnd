use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestMessage,
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
        ChatCompletionTool, ChatCompletionToolType, CreateChatCompletionRequestArgs,
        FunctionObject,
    },
    Client,
};

use super::{
    CompletionRequest, CompletionResponse, LlmError, LlmProvider, MessageRole, StopReason, ToolCall,
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
            let message = match msg.role {
                MessageRole::User => ChatCompletionRequestUserMessageArgs::default()
                    .content(msg.content)
                    .build()
                    .map_err(|e| LlmError::Configuration(e.to_string()))?
                    .into(),
                MessageRole::Assistant => ChatCompletionRequestAssistantMessageArgs::default()
                    .content(msg.content)
                    .build()
                    .map_err(|e| LlmError::Configuration(e.to_string()))?
                    .into(),
            };
            messages.push(message);
        }

        // Build tool definitions.
        let tools: Vec<ChatCompletionTool> = request
            .tools
            .into_iter()
            .map(|t| ChatCompletionTool {
                r#type: ChatCompletionToolType::Function,
                function: FunctionObject {
                    name: t.name,
                    description: Some(t.description),
                    parameters: Some(t.schema),
                    strict: None,
                },
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
            Some(async_openai::types::FinishReason::Stop) => StopReason::EndTurn,
            Some(async_openai::types::FinishReason::ToolCalls) => StopReason::ToolUse,
            Some(async_openai::types::FinishReason::Length) => StopReason::MaxTokens,
            Some(other) => StopReason::Other(format!("{other:?}")),
            None => StopReason::Other("none".to_string()),
        };

        let content = choice.message.content.filter(|s| !s.is_empty());

        let tool_calls = choice
            .message
            .tool_calls
            .unwrap_or_default()
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
