use std::collections::HashMap;

pub mod anthropic;
#[cfg(any(test, feature = "test-utils"))]
pub mod mock;
pub mod openai_compat;

pub use anthropic::AnthropicProvider;
pub use openai_compat::OpenAiCompatibleProvider;

// ── Error ────────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("HTTP transport error: {0}")]
    Http(String),

    #[error("API error (status {status}): {message}")]
    Api { status: u16, message: String },

    #[error("Deserialization error: {0}")]
    Deserialization(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Tool call argument parsing error: {0}")]
    ToolCallParsing(String),
}

impl From<reqwest::Error> for LlmError {
    fn from(e: reqwest::Error) -> Self {
        LlmError::Http(e.to_string())
    }
}

impl From<serde_json::Error> for LlmError {
    fn from(e: serde_json::Error) -> Self {
        LlmError::Deserialization(e.to_string())
    }
}

// ── Retry policy (shared across providers) ───────────────────────────────────

/// Ceiling for computed exponential backoff. Server-provided `retry-after`
/// values are honored verbatim and are not subject to this cap.
pub(crate) const RETRY_BACKOFF_CAP: std::time::Duration = std::time::Duration::from_secs(20);

/// How long to wait before retrying a failed LLM request.
#[derive(Debug, PartialEq)]
pub(crate) enum RetryDelay {
    /// Server-provided `retry-after` hint — honor verbatim, no jitter.
    Fixed(std::time::Duration),
    /// Computed exponential ceiling — the caller applies full jitter so that
    /// concurrent callers backing off together do not re-collide in lockstep.
    Backoff(std::time::Duration),
}

/// Classify an HTTP failure into a retry delay, or `None` when it is not
/// retriable. Retriable statuses: 429 (rate limit) and 529 (overload).
///
/// Priority: `retry-after-ms` header → `retry-after` (seconds) header →
/// exponential backoff ceiling (1s, 2s, 4s, … doubling, capped at
/// [`RETRY_BACKOFF_CAP`]).
pub(crate) fn retry_delay(
    status: u16,
    headers: &reqwest::header::HeaderMap,
    attempt: u32,
) -> Option<RetryDelay> {
    if status != 429 && status != 529 {
        return None;
    }
    if let Some(ms) = header_retry_after_ms(headers) {
        return Some(RetryDelay::Fixed(std::time::Duration::from_millis(ms)));
    }
    let cap_ms = RETRY_BACKOFF_CAP.as_millis() as u64;
    let base_ms = (1_000u64 << attempt.min(5)).min(cap_ms);
    Some(RetryDelay::Backoff(std::time::Duration::from_millis(
        base_ms,
    )))
}

/// Parse the server's retry-after hint (milliseconds), preferring the
/// millisecond header over the seconds header when both are present.
fn header_retry_after_ms(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    if let Some(ms) = headers
        .get("retry-after-ms")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
    {
        return Some(ms);
    }
    headers
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .map(|secs| secs * 1_000)
}

/// Resolve a [`RetryDelay`] to a concrete sleep duration. Computed backoff gets
/// full jitter (uniform in `[0, ceiling]`); server `retry-after` is verbatim.
pub(crate) fn resolve_retry_sleep(delay: RetryDelay) -> std::time::Duration {
    match delay {
        RetryDelay::Fixed(d) => d,
        RetryDelay::Backoff(ceiling) => {
            let ceil_ms = ceiling.as_millis() as u64;
            std::time::Duration::from_millis(fastrand::u64(0..=ceil_ms))
        }
    }
}

// ── Core types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum StopReason {
    EndTurn,
    ToolUse,
    MaxTokens,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    /// The tool-result turn: one entry per tool call executed in the previous
    /// assistant turn. The associated [`Message`]'s `content` must be
    /// `MessageContent::ToolResults`.
    Tool,
}

/// One tool-result entry, keyed by the opaque provider-generated call ID.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolResultPart {
    pub tool_call_id: String,
    pub content: String,
}

/// Typed content for a [`Message`].
///
/// - Plain text for `User` and `Assistant` turns.
/// - A structured list of tool results for `Tool` turns.
///
/// Uses `#[serde(untagged)]` so `Text` serializes as a bare JSON string and
/// `ToolResults` as a JSON array — no discriminant wrapper.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    ToolResults(Vec<ToolResultPart>),
}

impl From<String> for MessageContent {
    fn from(s: String) -> Self {
        MessageContent::Text(s)
    }
}

impl From<&str> for MessageContent {
    fn from(s: &str) -> Self {
        MessageContent::Text(s.to_string())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Message {
    pub role: MessageRole,
    pub content: MessageContent,
    /// Tool calls made by the assistant in this turn.
    ///
    /// Must be populated on `MessageRole::Assistant` messages that contain tool
    /// calls so that subsequent `MessageRole::Tool` result messages are
    /// understood by the provider in context. Empty for all other roles.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
}

/// A tool the LLM may call. `schema` must be a valid JSON Schema object.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub schema: serde_json::Value,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolCall {
    /// Opaque ID generated by the provider (not a UUID).
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

// ── Request / Response ───────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CompletionRequest {
    pub system: String,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolDefinition>,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    /// Tokens served from a prompt cache read (Anthropic `cache_read_input_tokens`,
    /// OpenAI `prompt_tokens_details.cached_tokens`). Already included in
    /// `prompt_tokens`; exposed separately for cache-hit-rate observability.
    #[serde(default)]
    pub cache_read_tokens: u32,
    /// Tokens written to the prompt cache on this call (Anthropic
    /// `cache_creation_input_tokens`; 0 for OpenAI-compatible backends).
    /// Already counted in `prompt_tokens` (Anthropic includes cache-creation
    /// tokens in `input_tokens`); exposed separately for cost observability.
    #[serde(default)]
    pub cache_creation_tokens: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CompletionResponse {
    pub content: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: StopReason,
    pub usage: Option<TokenUsage>,
}

/// The result of a single [`LlmProvider::complete`] call: the model response
/// plus transport metadata the caller needs for adaptive concurrency control.
///
/// `rate_limited` is kept off [`CompletionResponse`] deliberately — that type
/// is serialized and represents model output, whereas this is a per-call
/// transport observation (did the provider have to back off on a 429/529?).
#[derive(Debug, Clone)]
pub struct Completion {
    pub response: CompletionResponse,
    /// `true` if the provider observed and retried at least one rate-limit
    /// (429) or overload (529) response while producing this completion.
    pub rate_limited: bool,
}

impl Completion {
    /// Wrap a response that completed without any rate-limit retries.
    pub fn ok(response: CompletionResponse) -> Self {
        Self {
            response,
            rate_limited: false,
        }
    }
}

// ── Trait ────────────────────────────────────────────────────────────────────

#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    async fn complete(&self, request: CompletionRequest) -> Result<Completion, LlmError>;

    fn name(&self) -> &str;

    fn model(&self) -> &str;
}

// ── Provider registry ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProviderTier {
    Fast,
    Capable,
}

pub struct ProviderRegistry {
    providers: HashMap<ProviderTier, Box<dyn LlmProvider>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
        }
    }

    pub fn register(&mut self, tier: ProviderTier, provider: Box<dyn LlmProvider>) {
        self.providers.insert(tier, provider);
    }

    pub fn get(&self, tier: ProviderTier) -> Option<&dyn LlmProvider> {
        self.providers.get(&tier).map(|p| p.as_ref())
    }
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn retry_delay_none_for_non_retriable_status() {
        let headers = reqwest::header::HeaderMap::new();
        for status in [200, 400, 500, 503] {
            assert_eq!(retry_delay(status, &headers, 0), None, "status {status}");
        }
    }

    #[test]
    fn retry_delay_uses_retry_after_ms_header() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("retry-after-ms", "2500".parse().unwrap());
        assert_eq!(
            retry_delay(429, &headers, 0),
            Some(RetryDelay::Fixed(Duration::from_millis(2500)))
        );
    }

    #[test]
    fn retry_delay_converts_retry_after_seconds_header() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("retry-after", "3".parse().unwrap());
        assert_eq!(
            retry_delay(429, &headers, 0),
            Some(RetryDelay::Fixed(Duration::from_secs(3)))
        );
    }

    #[test]
    fn retry_delay_prefers_ms_header_over_seconds() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("retry-after-ms", "1500".parse().unwrap());
        headers.insert("retry-after", "10".parse().unwrap());
        assert_eq!(
            retry_delay(429, &headers, 0),
            Some(RetryDelay::Fixed(Duration::from_millis(1500)))
        );
    }

    #[test]
    fn retry_delay_exponential_backoff_ceiling_when_no_header() {
        let headers = reqwest::header::HeaderMap::new();
        assert_eq!(
            retry_delay(429, &headers, 0),
            Some(RetryDelay::Backoff(Duration::from_secs(1)))
        );
        assert_eq!(
            retry_delay(429, &headers, 1),
            Some(RetryDelay::Backoff(Duration::from_secs(2)))
        );
        assert_eq!(
            retry_delay(429, &headers, 2),
            Some(RetryDelay::Backoff(Duration::from_secs(4)))
        );
    }

    #[test]
    fn retry_delay_caps_backoff_ceiling() {
        let headers = reqwest::header::HeaderMap::new();
        // 2^99 would overflow; min(5) bounds the shift, then RETRY_BACKOFF_CAP applies.
        assert_eq!(
            retry_delay(429, &headers, 99),
            Some(RetryDelay::Backoff(RETRY_BACKOFF_CAP))
        );
    }

    #[test]
    fn retry_delay_applies_to_529_overload() {
        let headers = reqwest::header::HeaderMap::new();
        assert_eq!(
            retry_delay(529, &headers, 0),
            Some(RetryDelay::Backoff(Duration::from_secs(1)))
        );
    }

    #[test]
    fn resolve_retry_sleep_honors_fixed_verbatim() {
        let d = Duration::from_millis(2500);
        assert_eq!(resolve_retry_sleep(RetryDelay::Fixed(d)), d);
    }

    #[test]
    fn resolve_retry_sleep_jitters_backoff_within_ceiling() {
        let ceiling = Duration::from_secs(4);
        // Full jitter: every sample must land in [0, ceiling].
        for _ in 0..1000 {
            let slept = resolve_retry_sleep(RetryDelay::Backoff(ceiling));
            assert!(slept <= ceiling, "{slept:?} exceeded ceiling {ceiling:?}");
        }
    }
}
