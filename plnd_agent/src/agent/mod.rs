use std::sync::Arc;

use uuid::Uuid;

use crate::config::LlmConfig;
use crate::context::UseCase;
use crate::provider::{
    AnthropicProvider, CompletionRequest, LlmError, LlmProvider, Message, MessageContent,
    MessageRole, OpenAiCompatibleProvider, ProviderRegistry, ProviderTier, ToolCall,
    ToolResultPart,
};
use crate::tools::{ToolContext, ToolError, ToolRegistry};

// ── Errors ────────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("No provider registered for tier {0:?}")]
    NoProvider(ProviderTier),

    #[error("LLM error: {0}")]
    Llm(#[from] LlmError),

    #[error("Tool error: {0}")]
    Tool(#[from] ToolError),
}

// ── Output ────────────────────────────────────────────────────────────────────

/// The result of a completed agentic run.
///
/// For now this carries the raw final text from the LLM (or the terminal
/// tool's JSON result). JSON schema validation against use-case-specific
/// schemas is deferred to a later issue.
#[derive(Debug, Clone)]
pub struct AgentOutput {
    pub content: String,
}

// ── Internal result type used during parallel tool execution ─────────────────

struct ToolResult {
    tool_call_id: String,
    result: Result<serde_json::Value, ToolError>,
}

// ── AgentLoop ─────────────────────────────────────────────────────────────────

/// Core agentic loop: LLM call → parallel tool execution → append results →
/// repeat until the LLM issues no tool calls or `max_iterations` is reached.
struct AgentLoop<'a> {
    registry: &'a ProviderRegistry,
    tools: &'a ToolRegistry,
    max_iterations: u32,
    max_tokens: u32,
}

impl AgentLoop<'_> {
    async fn run(
        &self,
        user_id: Uuid,
        tier: ProviderTier,
        system: String,
        initial_messages: Vec<Message>,
    ) -> Result<AgentOutput, AgentError> {
        let provider = self
            .registry
            .get(tier)
            .ok_or(AgentError::NoProvider(tier))?;

        let tool_defs = self.tools.definitions();
        let ctx = ToolContext { user_id };
        let mut messages = initial_messages;
        let mut last_content: Option<String> = None;

        for _ in 0..self.max_iterations {
            let request = CompletionRequest {
                system: system.clone(),
                messages: messages.clone(),
                tools: tool_defs.clone(),
                max_tokens: self.max_tokens,
            };

            let response = provider.complete(request).await?;

            // Capture any text the LLM produced alongside (or instead of) tool calls.
            if let Some(ref text) = response.content {
                if !text.is_empty() {
                    last_content = Some(text.clone());
                }
            }

            // Record the assistant turn in history.
            messages.push(Message {
                role: MessageRole::Assistant,
                content: MessageContent::Text(response.content.clone().unwrap_or_default()),
            });

            // No tool calls → natural end turn.
            if response.tool_calls.is_empty() {
                break;
            }

            // Scan in insertion order for the first terminal tool in this batch.
            // "First encountered" is deterministic based on the LLM's output order.
            let terminal_call_id: Option<String> = response
                .tool_calls
                .iter()
                .find(|tc| self.tools.is_terminal(&tc.name))
                .map(|tc| tc.id.clone());

            // Execute all tool calls in the batch in parallel.
            let tool_results = self.execute_tools_parallel(&ctx, response.tool_calls).await;

            // If a terminal tool was in the batch, capture its result.
            if let Some(ref term_id) = terminal_call_id {
                if let Some(tr) = tool_results.iter().find(|r| &r.tool_call_id == term_id) {
                    if let Ok(ref val) = tr.result {
                        last_content = Some(val.to_string());
                    }
                }
            }

            // Append all results as a single Tool-role message (grouped so
            // Anthropic receives them in one user turn as required by its API).
            let parts: Vec<ToolResultPart> = tool_results
                .into_iter()
                .map(|tr| ToolResultPart {
                    tool_call_id: tr.tool_call_id,
                    content: match tr.result {
                        Ok(val) => val.to_string(),
                        Err(e) => serde_json::json!({ "error": e.to_string() }).to_string(),
                    },
                })
                .collect();

            messages.push(Message {
                role: MessageRole::Tool,
                content: MessageContent::ToolResults(parts),
            });

            // Terminal tool was in the batch → stop after executing everything.
            if terminal_call_id.is_some() {
                break;
            }
        }

        // If the loop exits because max_iterations was reached (rather than a
        // natural end-turn or terminal tool), the last tool-result message was
        // appended to history but the LLM never consumed it. This is intentional:
        // the ceiling exists to prevent runaway loops, and the caller receives
        // whatever content was last captured (possibly empty string).
        Ok(AgentOutput {
            content: last_content.unwrap_or_default(),
        })
    }

    /// Execute all tool calls in parallel using `tokio::task::JoinSet`.
    ///
    /// Results are returned in completion order (non-deterministic). The
    /// caller identifies terminal results by `tool_call_id`, not by position.
    async fn execute_tools_parallel(
        &self,
        ctx: &ToolContext,
        tool_calls: Vec<ToolCall>,
    ) -> Vec<ToolResult> {
        let mut join_set: tokio::task::JoinSet<ToolResult> = tokio::task::JoinSet::new();

        for tc in tool_calls {
            let tool_opt = self.tools.get(&tc.name);
            let ctx_clone = ctx.clone();
            let call_id = tc.id.clone();

            join_set.spawn(async move {
                let result = match tool_opt {
                    Some(tool) => tool.execute(&ctx_clone, tc.arguments).await,
                    None => Err(ToolError::NotFound(tc.name)),
                };
                ToolResult {
                    tool_call_id: call_id,
                    result,
                }
            });
        }

        let mut results = Vec::new();
        while let Some(join_result) = join_set.join_next().await {
            match join_result {
                Ok(tr) => results.push(tr),
                Err(e) => results.push(ToolResult {
                    tool_call_id: "unknown".to_string(),
                    result: Err(ToolError::Execution {
                        tool: "unknown".to_string(),
                        reason: format!("task panicked: {e}"),
                    }),
                }),
            }
        }
        results
    }
}

// ── AgentService ──────────────────────────────────────────────────────────────

/// Orchestrates an agentic run from a `plnd_api` route handler.
///
/// Holds LLM configuration and the provider registry built from it.
/// Wrapped in `Arc<ProviderRegistry>` so `AgentService` can be `Clone`
/// despite `ProviderRegistry` holding `Box<dyn LlmProvider>`.
#[derive(Clone)]
pub struct AgentService {
    pub config: LlmConfig,
    registry: Arc<ProviderRegistry>,
}

impl AgentService {
    /// Build an `AgentService` from LLM configuration, eagerly constructing
    /// HTTP clients for each provider tier.
    pub fn new(config: &LlmConfig) -> Self {
        let mut registry = ProviderRegistry::new();

        registry.register(ProviderTier::Fast, build_provider(&config.fast));
        registry.register(ProviderTier::Capable, build_provider(&config.capable));

        Self {
            config: config.clone(),
            registry: Arc::new(registry),
        }
    }

    /// Run the agentic loop for the given use case and user input.
    ///
    /// - `user_id` must come from the authenticated session — never from `input`.
    /// - `tools` is the pre-populated tool registry for this use case.
    /// - `input` is wrapped in `<user_input>` XML delimiters before being sent
    ///   to the LLM, per the security spec.
    pub async fn run(
        &self,
        user_id: Uuid,
        use_case: UseCase,
        tools: ToolRegistry,
        input: &str,
    ) -> Result<AgentOutput, AgentError> {
        // Step 1: Load memories — no-op stub (filled in by Phase 3.1).
        // When implemented: load from plnd_data filtered by use_case memory categories.

        // Step 2: Resolve system prompt.
        let system = use_case.system_prompt().to_string();

        // Step 3: Inject memories into context — no-op stub.
        // When implemented: prepend <memory ...> blocks to the first user message.

        // Step 4: Select provider tier.
        let tier = use_case.provider_tier();
        let max_tokens = match tier {
            ProviderTier::Fast => self.config.fast.max_tokens,
            ProviderTier::Capable => self.config.capable.max_tokens,
        };

        // Step 5: Build the initial message and fire the loop.
        // Wrap user input in untrusted delimiter per security spec.
        let wrapped = format!("<user_input>{}</user_input>", input);
        let initial_messages = vec![Message {
            role: MessageRole::User,
            content: MessageContent::Text(wrapped),
        }];

        let agent_loop = AgentLoop {
            registry: &self.registry,
            tools: &tools,
            max_iterations: 10, // TODO(#232): make configurable per use case
            max_tokens,
        };

        agent_loop
            .run(user_id, tier, system, initial_messages)
            .await
    }
}

// ── Provider factory ──────────────────────────────────────────────────────────

fn build_provider(config: &crate::config::LlmModelConfig) -> Box<dyn LlmProvider> {
    match config.provider.as_str() {
        "anthropic" => Box::new(
            AnthropicProvider::new(&config.api_key, &config.model).with_base_url(&config.base_url),
        ),
        _ => Box::new(OpenAiCompatibleProvider::new(
            &config.base_url,
            &config.api_key,
            &config.model,
        )),
    }
}

// ── impl Debug for AgentService ───────────────────────────────────────────────

impl std::fmt::Debug for AgentService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentService")
            .field("fast_provider", &self.config.fast.provider)
            .field("capable_provider", &self.config.capable.provider)
            .finish()
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use tokio::time::Duration;

    use super::*;
    use crate::provider::mock::MockLlmProvider;
    use crate::provider::{CompletionResponse, StopReason, ToolCall};
    use crate::tools::{Tool, ToolContext, ToolError, ToolRegistry};

    // ── Test helpers ──────────────────────────────────────────────────────────

    fn make_registry(mock: MockLlmProvider) -> ProviderRegistry {
        let mut registry = ProviderRegistry::new();
        registry.register(ProviderTier::Capable, Box::new(mock));
        registry
    }

    fn run_loop<'a>(
        registry: &'a ProviderRegistry,
        tools: &'a ToolRegistry,
        max_iterations: u32,
    ) -> AgentLoop<'a> {
        AgentLoop {
            registry,
            tools,
            max_iterations,
            max_tokens: 100,
        }
    }

    fn user_message(text: &str) -> Vec<Message> {
        vec![Message {
            role: MessageRole::User,
            content: MessageContent::Text(text.to_string()),
        }]
    }

    // ── NoopTool: returns immediately with {"ok": true} ───────────────────────

    struct NoopTool {
        name: &'static str,
        counter: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl Tool for NoopTool {
        fn name(&self) -> &str {
            self.name
        }
        fn description(&self) -> &str {
            "Does nothing"
        }
        fn schema(&self) -> serde_json::Value {
            serde_json::json!({})
        }
        async fn execute(
            &self,
            _ctx: &ToolContext,
            _input: serde_json::Value,
        ) -> Result<serde_json::Value, ToolError> {
            self.counter.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!({ "ok": true }))
        }
    }

    // ── SlowTool: sleeps 50 ms before returning ───────────────────────────────

    struct SlowTool {
        counter: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl Tool for SlowTool {
        fn name(&self) -> &str {
            "slow_tool"
        }
        fn description(&self) -> &str {
            "Slow tool for timing tests"
        }
        fn schema(&self) -> serde_json::Value {
            serde_json::json!({})
        }
        async fn execute(
            &self,
            _ctx: &ToolContext,
            _input: serde_json::Value,
        ) -> Result<serde_json::Value, ToolError> {
            tokio::time::sleep(Duration::from_millis(50)).await;
            self.counter.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!({ "ok": true }))
        }
    }

    // ── TerminalTool: marks is_terminal() = true ──────────────────────────────

    struct TerminalTool {
        counter: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl Tool for TerminalTool {
        fn name(&self) -> &str {
            "terminal_tool"
        }
        fn description(&self) -> &str {
            "Terminal tool"
        }
        fn schema(&self) -> serde_json::Value {
            serde_json::json!({})
        }
        fn is_terminal(&self) -> bool {
            true
        }
        async fn execute(
            &self,
            _ctx: &ToolContext,
            _input: serde_json::Value,
        ) -> Result<serde_json::Value, ToolError> {
            self.counter.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!({ "task_id": "abc-123" }))
        }
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    /// Provider always returns a tool call. With max_iterations = 3, the loop
    /// must stop after exactly 3 LLM calls — not run forever.
    #[tokio::test]
    async fn test_max_iterations_enforced() {
        let tool_counter = Arc::new(AtomicUsize::new(0));
        let mock = MockLlmProvider::new("test");
        let call_count = mock.call_count_handle();

        // Queue more responses than max_iterations to confirm the ceiling kicks in.
        for i in 0..10u32 {
            mock.push_response(CompletionResponse {
                content: None,
                tool_calls: vec![ToolCall {
                    id: format!("tc_{i}"),
                    name: "noop".to_string(),
                    arguments: serde_json::json!({}),
                }],
                stop_reason: StopReason::ToolUse,
            });
        }

        let registry = make_registry(mock);
        let mut tools = ToolRegistry::new();
        tools.register(Arc::new(NoopTool {
            name: "noop",
            counter: Arc::clone(&tool_counter),
        }));

        let agent_loop = run_loop(&registry, &tools, 3);
        let result = agent_loop
            .run(
                Uuid::nil(),
                ProviderTier::Capable,
                "sys".into(),
                user_message("go"),
            )
            .await;

        assert!(result.is_ok(), "loop should complete without error");
        assert_eq!(
            call_count.load(Ordering::SeqCst),
            3,
            "LLM must be called exactly max_iterations times"
        );
    }

    /// One slow tool invoked three times in parallel — each call takes 50 ms.
    /// Serial execution would take ~150 ms; parallel execution should complete
    /// well under 120 ms.
    #[tokio::test]
    async fn test_tools_execute_in_parallel() {
        let tool_counter = Arc::new(AtomicUsize::new(0));
        let mock = MockLlmProvider::new("test");

        // First response: three slow tool calls.
        mock.push_response(CompletionResponse {
            content: None,
            tool_calls: vec![
                ToolCall {
                    id: "tc_1".to_string(),
                    name: "slow_tool".to_string(),
                    arguments: serde_json::json!({}),
                },
                ToolCall {
                    id: "tc_2".to_string(),
                    name: "slow_tool".to_string(),
                    arguments: serde_json::json!({}),
                },
                ToolCall {
                    id: "tc_3".to_string(),
                    name: "slow_tool".to_string(),
                    arguments: serde_json::json!({}),
                },
            ],
            stop_reason: StopReason::ToolUse,
        });
        // Second response: end the loop.
        mock.push_response(CompletionResponse {
            content: Some("done".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        let registry = make_registry(mock);
        let mut tools = ToolRegistry::new();
        tools.register(Arc::new(SlowTool {
            counter: Arc::clone(&tool_counter),
        }));

        let agent_loop = run_loop(&registry, &tools, 10);

        let start = tokio::time::Instant::now();
        let result = agent_loop
            .run(
                Uuid::nil(),
                ProviderTier::Capable,
                "sys".into(),
                user_message("go"),
            )
            .await;
        let elapsed = start.elapsed();

        assert!(result.is_ok());
        assert_eq!(
            tool_counter.load(Ordering::SeqCst),
            3,
            "all three tools must have executed"
        );
        assert!(
            elapsed < Duration::from_millis(120),
            "tools should run in parallel; elapsed {elapsed:?} exceeds 120 ms ceiling"
        );
    }

    /// First batch contains a terminal tool AND a regular tool.
    /// The loop must: execute both tools in parallel, then stop.
    /// The LLM must never be called a second time.
    #[tokio::test]
    async fn test_terminal_tool_stops_loop() {
        let regular_counter = Arc::new(AtomicUsize::new(0));
        let terminal_counter = Arc::new(AtomicUsize::new(0));
        let mock = MockLlmProvider::new("test");
        let call_count = mock.call_count_handle();

        // First response: terminal + regular tool in the same batch.
        mock.push_response(CompletionResponse {
            content: None,
            tool_calls: vec![
                ToolCall {
                    id: "tc_terminal".to_string(),
                    name: "terminal_tool".to_string(),
                    arguments: serde_json::json!({}),
                },
                ToolCall {
                    id: "tc_noop".to_string(),
                    name: "noop".to_string(),
                    arguments: serde_json::json!({}),
                },
            ],
            stop_reason: StopReason::ToolUse,
        });
        // If the loop incorrectly continues, this response would be consumed.
        mock.push_response(CompletionResponse {
            content: Some("unexpected second call".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        let registry = make_registry(mock);
        let mut tools = ToolRegistry::new();
        tools.register(Arc::new(TerminalTool {
            counter: Arc::clone(&terminal_counter),
        }));
        tools.register(Arc::new(NoopTool {
            name: "noop",
            counter: Arc::clone(&regular_counter),
        }));

        let agent_loop = run_loop(&registry, &tools, 10);
        let result = agent_loop
            .run(
                Uuid::nil(),
                ProviderTier::Capable,
                "sys".into(),
                user_message("create task"),
            )
            .await;

        assert!(result.is_ok());
        // Terminal tool's JSON result must be the output.
        assert!(
            result.unwrap().content.contains("task_id"),
            "output should be terminal tool's result"
        );
        // Both tools in the batch must have executed.
        assert_eq!(
            terminal_counter.load(Ordering::SeqCst),
            1,
            "terminal tool must execute"
        );
        assert_eq!(
            regular_counter.load(Ordering::SeqCst),
            1,
            "regular tool must also execute"
        );
        // LLM must only have been called once.
        assert_eq!(
            call_count.load(Ordering::SeqCst),
            1,
            "LLM must not be called again after a terminal tool"
        );
    }
}
