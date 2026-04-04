use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

use super::{CompletionRequest, CompletionResponse, LlmError, LlmProvider};
#[cfg(test)]
use super::{Message, MessageContent, MessageRole, StopReason, ToolCall};

pub struct MockLlmProvider {
    responses: Mutex<VecDeque<Result<CompletionResponse, LlmError>>>,
    name: String,
    call_count: Arc<AtomicUsize>,
    last_request: Arc<Mutex<Option<CompletionRequest>>>,
}

impl MockLlmProvider {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            responses: Mutex::new(VecDeque::new()),
            name: name.into(),
            call_count: Arc::new(AtomicUsize::new(0)),
            last_request: Arc::new(Mutex::new(None)),
        }
    }

    /// Returns a clone of the shared last-request handle so tests can inspect
    /// the most recent `CompletionRequest` after the mock has been moved.
    pub fn last_request_handle(&self) -> Arc<Mutex<Option<CompletionRequest>>> {
        Arc::clone(&self.last_request)
    }

    pub fn push_response(&self, response: CompletionResponse) {
        self.responses.lock().unwrap().push_back(Ok(response));
    }

    pub fn push_error(&self, error: LlmError) {
        self.responses.lock().unwrap().push_back(Err(error));
    }

    /// Returns the number of times `complete()` has been called.
    /// Useful in tests for asserting loop iteration counts.
    pub fn call_count(&self) -> usize {
        self.call_count.load(Ordering::SeqCst)
    }

    /// Returns a clone of the shared call-count handle so tests can inspect
    /// it after the mock has been moved into a `Box<dyn LlmProvider>`.
    pub fn call_count_handle(&self) -> Arc<AtomicUsize> {
        Arc::clone(&self.call_count)
    }
}

#[async_trait::async_trait]
impl LlmProvider for MockLlmProvider {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, LlmError> {
        self.call_count.fetch_add(1, Ordering::SeqCst);
        *self.last_request.lock().unwrap() = Some(request);
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| panic!("MockLlmProvider '{}': no more responses queued", self.name))
    }

    fn name(&self) -> &str {
        &self.name
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_request() -> CompletionRequest {
        CompletionRequest {
            system: "You are a test assistant.".to_string(),
            messages: vec![Message {
                role: MessageRole::User,
                content: MessageContent::Text("test".to_string()),
                tool_calls: vec![],
            }],
            tools: vec![],
            max_tokens: 100,
        }
    }

    #[tokio::test]
    async fn test_happy_path_text_completion() {
        let provider = MockLlmProvider::new("test");
        provider.push_response(CompletionResponse {
            content: Some("hello world".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        let result = provider.complete(minimal_request()).await.unwrap();

        assert_eq!(result.content, Some("hello world".to_string()));
        assert!(result.tool_calls.is_empty());
        assert_eq!(result.stop_reason, StopReason::EndTurn);
    }

    #[tokio::test]
    async fn test_tool_call_response() {
        let provider = MockLlmProvider::new("test");
        provider.push_response(CompletionResponse {
            content: None,
            tool_calls: vec![ToolCall {
                id: "tc_1".to_string(),
                name: "find_schedule_slot".to_string(),
                arguments: serde_json::json!({"energy_level": "high"}),
            }],
            stop_reason: StopReason::ToolUse,
        });

        let result = provider.complete(minimal_request()).await.unwrap();

        assert_eq!(result.content, None);
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].name, "find_schedule_slot");
        assert_eq!(
            result.tool_calls[0].arguments,
            serde_json::json!({"energy_level": "high"})
        );
        assert_eq!(result.stop_reason, StopReason::ToolUse);
    }

    #[tokio::test]
    async fn test_max_tokens_stop_reason() {
        let provider = MockLlmProvider::new("test");
        provider.push_response(CompletionResponse {
            content: Some("truncated...".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::MaxTokens,
        });

        let result = provider.complete(minimal_request()).await.unwrap();

        assert_eq!(result.stop_reason, StopReason::MaxTokens);
    }

    #[tokio::test]
    async fn test_call_count_tracks_invocations() {
        let provider = MockLlmProvider::new("test");
        provider.push_response(CompletionResponse {
            content: Some("a".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });
        provider.push_response(CompletionResponse {
            content: Some("b".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        assert_eq!(provider.call_count(), 0);
        provider.complete(minimal_request()).await.unwrap();
        assert_eq!(provider.call_count(), 1);
        provider.complete(minimal_request()).await.unwrap();
        assert_eq!(provider.call_count(), 2);
    }
}
