use std::sync::Arc;

use uuid::Uuid;

use crate::config::LlmConfig;
use crate::context::AgentContext;
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

    #[error("Database error: {0}")]
    Database(#[from] plnd_data::db::error::DatabaseError),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Convert a `serde_json::Value` to a string without double-quoting plain
/// string values. `Value::String("ok")` → `"ok"`, not `"\"ok\""`.
fn json_to_string(v: serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s,
        other => other.to_string(),
    }
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

            // Record the assistant turn in history, including any tool calls so
            // that subsequent tool-result messages are understood in context by
            // both Anthropic and OpenAI APIs.
            messages.push(Message {
                role: MessageRole::Assistant,
                content: MessageContent::Text(response.content.clone().unwrap_or_default()),
                tool_calls: response.tool_calls.clone(),
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
                        last_content = Some(json_to_string(val.clone()));
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
                        Ok(val) => json_to_string(val),
                        Err(e) => serde_json::json!({ "error": e.to_string() }).to_string(),
                    },
                })
                .collect();

            messages.push(Message {
                role: MessageRole::Tool,
                content: MessageContent::ToolResults(parts),
                tool_calls: vec![],
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
        let mut call_id_map: std::collections::HashMap<tokio::task::Id, (String, String)> =
            std::collections::HashMap::with_capacity(tool_calls.len());

        for tc in tool_calls {
            let tool_opt = self.tools.get(&tc.name);
            let ctx_clone = ctx.clone();
            let call_id = tc.id;
            let tool_name = tc.name.clone();

            let handle = join_set.spawn({
                let call_id = call_id.clone();
                async move {
                    let result = match tool_opt {
                        Some(tool) => tool.execute(&ctx_clone, tc.arguments).await,
                        None => Err(ToolError::NotFound(tc.name)),
                    };
                    ToolResult {
                        tool_call_id: call_id,
                        result,
                    }
                }
            });
            call_id_map.insert(handle.id(), (call_id, tool_name));
        }

        let mut results = Vec::new();
        while let Some(join_result) = join_set.join_next().await {
            match join_result {
                Ok(tr) => results.push(tr),
                Err(e) => {
                    let (call_id, tool_name) = call_id_map
                        .remove(&e.id())
                        .unwrap_or_else(|| ("unknown".to_string(), "unknown".to_string()));
                    results.push(ToolResult {
                        tool_call_id: call_id,
                        result: Err(ToolError::Execution {
                            tool: tool_name,
                            reason: format!("task panicked: {e}"),
                        }),
                    });
                }
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
    /// Database for loading user memories. `None` only in unit-test constructors
    /// that do not exercise the memory-loading path.
    db: Option<plnd_data::db::Database>,
}

impl AgentService {
    /// Build an `AgentService` from LLM configuration, eagerly constructing
    /// HTTP clients for each provider tier.
    pub fn new(config: &LlmConfig, db: plnd_data::db::Database) -> Self {
        let mut registry = ProviderRegistry::new();

        registry.register(ProviderTier::Fast, build_provider(&config.fast));
        registry.register(ProviderTier::Capable, build_provider(&config.capable));

        Self {
            config: config.clone(),
            registry: Arc::new(registry),
            db: Some(db),
        }
    }

    /// Run the agentic loop for the given context and tool registry.
    ///
    /// - `ctx.user_id` must come from the authenticated session — never from `ctx.input`.
    /// - `tools` is the pre-populated tool registry for this use case.
    /// - `ctx.input` is wrapped in `<user_input>` XML delimiters before being sent
    ///   to the LLM, per the security spec.
    /// - `ctx.memory_context`, if present, is prepended to the system prompt as a
    ///   `<memory>` block so the LLM has relevant user context before any tool calls.
    pub async fn run(
        &self,
        ctx: &AgentContext,
        tools: ToolRegistry,
    ) -> Result<AgentOutput, AgentError> {
        // Step 1: Load memories filtered by use case.
        let memory_entries = if let Some(ref db) = self.db {
            let memories = plnd_data::db::memories::get_memories(
                db.get_pool(),
                ctx.user_id,
                ctx.use_case.memory_categories(),
            )
            .await?;
            if memories.is_empty() {
                None
            } else {
                Some(
                    memories
                        .iter()
                        .map(|m| {
                            format!("  <entry category=\"{}\">{}</entry>", m.category, m.content)
                        })
                        .collect::<Vec<_>>()
                        .join("\n"),
                )
            }
        } else {
            None
        };

        // Step 2: Resolve system prompt.
        let base_system = ctx.use_case.system_prompt().to_string();

        // Step 3: Inject memories into system prompt preamble if present.
        let system = match memory_entries {
            Some(ref entries) => format!("<memory>\n{}\n</memory>\n\n{}", entries, base_system),
            None => base_system,
        };

        // Step 4: Select provider tier.
        let tier = ctx.use_case.provider_tier();
        let (max_tokens, max_iterations) = match tier {
            ProviderTier::Fast => (self.config.fast.max_tokens, self.config.fast.max_iterations),
            ProviderTier::Capable => (
                self.config.capable.max_tokens,
                self.config.capable.max_iterations,
            ),
        };

        // Step 5: Build the initial message and fire the loop.
        // Wrap user input in untrusted delimiter per security spec.
        let wrapped = format!("<user_input>{}</user_input>", ctx.input);
        let initial_messages = vec![Message {
            role: MessageRole::User,
            content: MessageContent::Text(wrapped),
            tool_calls: vec![],
        }];

        let agent_loop = AgentLoop {
            registry: &self.registry,
            tools: &tools,
            max_iterations,
            max_tokens,
        };

        agent_loop
            .run(ctx.user_id, tier, system, initial_messages)
            .await
    }
}

// ── Provider factory ──────────────────────────────────────────────────────────

fn build_provider(config: &crate::config::LlmModelConfig) -> Box<dyn LlmProvider> {
    match config.provider.as_str() {
        "anthropic" => {
            let mut p = AnthropicProvider::new(&config.api_key, &config.model)
                .with_base_url(&config.base_url);
            if let Some(v) = &config.api_version {
                p = p.with_api_version(v);
            }
            Box::new(p)
        }
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
            .field("db", &self.db.as_ref().map(|_| "<Database>"))
            .finish()
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
impl AgentService {
    /// Test-only constructor that injects a pre-built registry.
    ///
    /// Sets `db = None` so memory loading is skipped. Use
    /// `new_with_registry_and_db` for tests that exercise the memory path.
    fn new_with_registry(registry: ProviderRegistry) -> Self {
        use crate::config::LlmModelConfig;
        let model_cfg = LlmModelConfig {
            max_iterations: 10,
            max_tokens: 1024,
            ..LlmModelConfig::default()
        };
        Self {
            config: crate::config::LlmConfig {
                fast: model_cfg.clone(),
                capable: model_cfg,
            },
            registry: Arc::new(registry),
            db: None,
        }
    }

    /// Test-only constructor that exercises the memory-loading path.
    fn new_with_registry_and_db(registry: ProviderRegistry, db: plnd_data::db::Database) -> Self {
        use crate::config::LlmModelConfig;
        let model_cfg = LlmModelConfig {
            max_iterations: 10,
            max_tokens: 1024,
            ..LlmModelConfig::default()
        };
        Self {
            config: crate::config::LlmConfig {
                fast: model_cfg.clone(),
                capable: model_cfg,
            },
            registry: Arc::new(registry),
            db: Some(db),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use tokio::time::Duration;

    use super::*;
    use crate::context::{AgentContext, UseCase};
    use crate::provider::mock::MockLlmProvider;
    use crate::provider::{
        CompletionResponse, LlmError, MessageContent, MessageRole, StopReason, ToolCall,
    };
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
            tool_calls: vec![],
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

    // ── PanicTool: always panics to test JoinSet error handling ──────────────

    struct PanicTool;

    #[async_trait::async_trait]
    impl Tool for PanicTool {
        fn name(&self) -> &str {
            "panic_tool"
        }
        fn description(&self) -> &str {
            "Always panics"
        }
        fn schema(&self) -> serde_json::Value {
            serde_json::json!({})
        }
        async fn execute(
            &self,
            _ctx: &ToolContext,
            _input: serde_json::Value,
        ) -> Result<serde_json::Value, ToolError> {
            panic!("deliberate test panic");
        }
    }

    // ── FailTool: always returns ToolError::Execution ────────────────────────

    struct FailTool;

    #[async_trait::async_trait]
    impl Tool for FailTool {
        fn name(&self) -> &str {
            "fail_tool"
        }
        fn description(&self) -> &str {
            "Always fails with an execution error"
        }
        fn schema(&self) -> serde_json::Value {
            serde_json::json!({})
        }
        async fn execute(
            &self,
            _ctx: &ToolContext,
            _input: serde_json::Value,
        ) -> Result<serde_json::Value, ToolError> {
            Err(ToolError::Execution {
                tool: "fail_tool".to_string(),
                reason: "boom".to_string(),
            })
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

    /// A tool that panics inside its spawned task must produce a `ToolResult`
    /// whose `tool_call_id` matches the original call ID — not `"unknown"`.
    ///
    /// Regression test for issue #243.
    #[tokio::test]
    async fn test_panic_preserves_call_id() {
        let registry = ProviderRegistry::new(); // unused — test calls execute_tools_parallel directly
        let mut tools = ToolRegistry::new();
        tools.register(Arc::new(PanicTool));

        let agent_loop = run_loop(&registry, &tools, 1);
        let ctx = ToolContext {
            user_id: Uuid::nil(),
        };

        let tool_calls = vec![ToolCall {
            id: "tc_panic_42".to_string(),
            name: "panic_tool".to_string(),
            arguments: serde_json::json!({}),
        }];

        let results = agent_loop.execute_tools_parallel(&ctx, tool_calls).await;

        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].tool_call_id, "tc_panic_42",
            "panicked task must preserve the original tool_call_id"
        );
        match &results[0].result {
            Err(ToolError::Execution { tool, .. }) => {
                assert_eq!(
                    tool, "panic_tool",
                    "panicked task must preserve the tool name"
                );
            }
            other => panic!("expected ToolError::Execution, got {other:?}"),
        }
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

    // ── Helpers for DB-backed tests ───────────────────────────────────────────

    /// Connect to the test DB from `DATABASE_URL`, or return `None` to skip.
    async fn test_db() -> Option<plnd_data::db::Database> {
        let url = std::env::var("DATABASE_URL").ok()?;
        plnd_data::db::Database::new(&url, 1).await.ok()
    }

    /// Create a throwaway user and return its UUID.
    async fn new_user(db: &plnd_data::db::Database) -> Uuid {
        plnd_data::db::users::create(
            db.get_pool(),
            &format!("{}@test.invalid", Uuid::new_v4()),
            None,
            None,
        )
        .await
        .expect("failed to create test user")
        .user_id
    }

    // ── AgentService::run — AgentContext wiring tests ─────────────────────────

    /// When the DB has memories for this user+use_case, the system prompt sent
    /// to the LLM must be prefixed with a `<memory>` block containing the
    /// matching entries.
    ///
    /// Requires `DATABASE_URL` to be set (provided by `just verify`).
    #[tokio::test]
    async fn test_memory_context_prepended_to_system_prompt() {
        let db = match test_db().await {
            Some(db) => db,
            None => return, // skip when running without a DB
        };
        let user_id = new_user(&db).await;
        plnd_data::db::memories::create_memory(
            db.get_pool(),
            user_id,
            "habits",
            "user prefers oat milk",
            vec![],
        )
        .await
        .expect("seed failed");

        let mock = MockLlmProvider::new("test");
        let last_request = mock.last_request_handle();
        mock.push_response(CompletionResponse {
            content: Some("done".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        let service = AgentService::new_with_registry_and_db(make_registry(mock), db);
        let ctx = AgentContext {
            user_id,
            use_case: UseCase::TaskEntry,
            input: "add milk to grocery list".to_string(),
        };

        let result = service.run(&ctx, ToolRegistry::new()).await;
        assert!(result.is_ok());

        let req = last_request.lock().unwrap();
        let system = &req.as_ref().unwrap().system;
        assert!(
            system.starts_with("<memory>"),
            "system prompt must start with <memory> block; got: {system}"
        );
        assert!(
            system.contains("user prefers oat milk"),
            "memory text must appear in system prompt"
        );
        assert!(
            system.contains("<user_input>"),
            "base system prompt (which references <user_input>) must follow the memory block"
        );
    }

    /// When the DB has no memories for this user, the system prompt must be the
    /// raw use-case prompt with no `<memory>` preamble.
    ///
    /// Requires `DATABASE_URL` to be set (provided by `just verify`).
    #[tokio::test]
    async fn test_no_memories_omits_memory_block() {
        let db = match test_db().await {
            Some(db) => db,
            None => return,
        };
        // Real user with no memories seeded.
        let user_id = new_user(&db).await;

        let mock = MockLlmProvider::new("test");
        let last_request = mock.last_request_handle();
        mock.push_response(CompletionResponse {
            content: Some("done".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        let service = AgentService::new_with_registry_and_db(make_registry(mock), db);
        let ctx = AgentContext {
            user_id,
            use_case: UseCase::TaskEntry,
            input: "add milk to grocery list".to_string(),
        };

        let result = service.run(&ctx, ToolRegistry::new()).await;
        assert!(result.is_ok());

        let req = last_request.lock().unwrap();
        let system = &req.as_ref().unwrap().system;
        assert!(
            !system.contains("<memory>"),
            "system prompt must not contain <memory> block when user has no memories"
        );
        assert_eq!(
            system.as_str(),
            UseCase::TaskEntry.system_prompt(),
            "system prompt must be the raw use-case prompt"
        );
    }

    /// Task entry run must receive habits/schedule/energy memories but not food.
    ///
    /// Requires `DATABASE_URL` to be set (provided by `just verify`).
    #[tokio::test]
    async fn test_task_entry_injects_task_memories_not_food() {
        let db = match test_db().await {
            Some(db) => db,
            None => return,
        };
        let user_id = new_user(&db).await;
        for (cat, content) in [
            ("habits", "wakes up at 7am"),
            ("schedule", "productive in the mornings"),
            ("energy", "low energy after lunch"),
            ("food", "likes spicy food"),
        ] {
            plnd_data::db::memories::create_memory(db.get_pool(), user_id, cat, content, vec![])
                .await
                .expect("seed failed");
        }

        let mock = MockLlmProvider::new("test");
        let last_request = mock.last_request_handle();
        mock.push_response(CompletionResponse {
            content: Some("done".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        let service = AgentService::new_with_registry_and_db(make_registry(mock), db);
        let ctx = AgentContext {
            user_id,
            use_case: UseCase::TaskEntry,
            input: "add task".to_string(),
        };

        service.run(&ctx, ToolRegistry::new()).await.unwrap();

        let req = last_request.lock().unwrap();
        let system = &req.as_ref().unwrap().system;
        assert!(system.contains("wakes up at 7am"), "habits memory missing");
        assert!(
            system.contains("productive in the mornings"),
            "schedule memory missing"
        );
        assert!(
            system.contains("low energy after lunch"),
            "energy memory missing"
        );
        assert!(
            !system.contains("likes spicy food"),
            "food memory must not appear in TaskEntry run"
        );
    }

    /// Meal planning run must receive food/habits memories but not schedule.
    ///
    /// Requires `DATABASE_URL` to be set (provided by `just verify`).
    #[tokio::test]
    async fn test_meal_planning_injects_meal_memories_not_schedule() {
        let db = match test_db().await {
            Some(db) => db,
            None => return,
        };
        let user_id = new_user(&db).await;
        for (cat, content) in [
            ("food", "likes mediterranean cuisine"),
            ("habits", "fridays = sandwich"),
            ("schedule", "productive in the mornings"),
        ] {
            plnd_data::db::memories::create_memory(db.get_pool(), user_id, cat, content, vec![])
                .await
                .expect("seed failed");
        }

        let mock = MockLlmProvider::new("test");
        let last_request = mock.last_request_handle();
        mock.push_response(CompletionResponse {
            content: Some("done".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        let service = AgentService::new_with_registry_and_db(make_registry(mock), db);
        let ctx = AgentContext {
            user_id,
            use_case: UseCase::MealPlanning,
            input: "plan my meals".to_string(),
        };

        service.run(&ctx, ToolRegistry::new()).await.unwrap();

        let req = last_request.lock().unwrap();
        let system = &req.as_ref().unwrap().system;
        assert!(
            system.contains("likes mediterranean cuisine"),
            "food memory missing"
        );
        assert!(
            system.contains("fridays = sandwich"),
            "habits memory missing"
        );
        assert!(
            !system.contains("productive in the mornings"),
            "schedule memory must not appear in MealPlanning run"
        );
    }

    /// User input must always be wrapped in `<user_input>` delimiters in the
    /// first user message.
    #[tokio::test]
    async fn test_user_input_wrapped_in_delimiter() {
        let mock = MockLlmProvider::new("test");
        let last_request = mock.last_request_handle();
        mock.push_response(CompletionResponse {
            content: Some("done".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        // new_with_registry sets db = None, so memory loading is skipped.
        let service = AgentService::new_with_registry(make_registry(mock));

        let ctx = AgentContext {
            user_id: Uuid::nil(),
            use_case: UseCase::TaskEntry,
            input: "replace vacuum filter".to_string(),
        };

        let result = service.run(&ctx, ToolRegistry::new()).await;
        assert!(result.is_ok());

        let req = last_request.lock().unwrap();
        let first_message = &req.as_ref().unwrap().messages[0];
        let MessageContent::Text(ref text) = first_message.content else {
            panic!("expected Text message content");
        };
        assert_eq!(
            text.as_str(),
            "<user_input>replace vacuum filter</user_input>",
            "user input must be wrapped in security delimiters"
        );
    }

    // ── Error-path tests ──────────────────────────────────────────────────────

    /// When the LLM provider returns an error, the loop must propagate it as
    /// `AgentError::Llm` — not swallow or wrap it in some other variant.
    #[tokio::test]
    async fn test_llm_provider_error_propagates_as_agent_error_llm() {
        let mock = MockLlmProvider::new("test");
        mock.push_error(LlmError::Http("connection refused".to_string()));

        let registry = make_registry(mock);
        let tools = ToolRegistry::new();
        let agent_loop = run_loop(&registry, &tools, 10);

        let result = agent_loop
            .run(
                Uuid::nil(),
                ProviderTier::Capable,
                "sys".into(),
                user_message("go"),
            )
            .await;

        assert!(result.is_err(), "loop must fail when the LLM errors");
        assert!(
            matches!(result.unwrap_err(), AgentError::Llm(_)),
            "error must be AgentError::Llm"
        );
    }

    /// When a registered tool returns `Err(ToolError::Execution)`, the loop must
    /// NOT treat it as a fatal error.  Instead it must serialize the error into a
    /// tool-result message and pass it back to the LLM so the LLM can recover.
    #[tokio::test]
    async fn test_tool_execution_failure_sent_back_as_tool_result() {
        let mock = MockLlmProvider::new("test");
        let last_request = mock.last_request_handle();

        // First response: call the failing tool.
        mock.push_response(CompletionResponse {
            content: None,
            tool_calls: vec![ToolCall {
                id: "tc_fail".to_string(),
                name: "fail_tool".to_string(),
                arguments: serde_json::json!({}),
            }],
            stop_reason: StopReason::ToolUse,
        });
        // Second response: LLM acknowledges and ends turn.
        mock.push_response(CompletionResponse {
            content: Some("recovered".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        let registry = make_registry(mock);
        let mut tools = ToolRegistry::new();
        tools.register(Arc::new(FailTool));

        let agent_loop = run_loop(&registry, &tools, 10);
        let result = agent_loop
            .run(
                Uuid::nil(),
                ProviderTier::Capable,
                "sys".into(),
                user_message("go"),
            )
            .await;

        assert!(result.is_ok(), "tool execution error must not be fatal");

        // The second LLM request must contain the tool-result message with the
        // serialized error so the LLM could reason about the failure.
        let req = last_request.lock().unwrap();
        let messages = &req.as_ref().unwrap().messages;
        let tool_msg = messages
            .iter()
            .find(|m| m.role == MessageRole::Tool)
            .expect("a Tool-role message must be present in the second request");
        let MessageContent::ToolResults(ref parts) = tool_msg.content else {
            panic!("Tool message must have ToolResults content");
        };
        assert_eq!(parts.len(), 1);
        assert!(
            parts[0].content.contains("boom"),
            "tool result must contain the execution error reason; got: {}",
            parts[0].content
        );
    }

    /// When the LLM calls a tool that is not registered, the loop must NOT crash.
    /// Instead it must return a `ToolError::NotFound` result to the LLM so it can
    /// recover, then continue the loop normally.
    #[tokio::test]
    async fn test_unregistered_tool_call_returns_not_found_in_tool_result() {
        let mock = MockLlmProvider::new("test");
        let last_request = mock.last_request_handle();

        // First response: call a tool that was never registered.
        mock.push_response(CompletionResponse {
            content: None,
            tool_calls: vec![ToolCall {
                id: "tc_ghost".to_string(),
                name: "ghost_tool".to_string(),
                arguments: serde_json::json!({}),
            }],
            stop_reason: StopReason::ToolUse,
        });
        // Second response: LLM ends turn after receiving the error.
        mock.push_response(CompletionResponse {
            content: Some("done".to_string()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
        });

        let registry = make_registry(mock);
        let tools = ToolRegistry::new(); // no tools registered

        let agent_loop = run_loop(&registry, &tools, 10);
        let result = agent_loop
            .run(
                Uuid::nil(),
                ProviderTier::Capable,
                "sys".into(),
                user_message("go"),
            )
            .await;

        assert!(result.is_ok(), "unknown tool call must not be fatal");

        let req = last_request.lock().unwrap();
        let messages = &req.as_ref().unwrap().messages;
        let tool_msg = messages
            .iter()
            .find(|m| m.role == MessageRole::Tool)
            .expect("a Tool-role message must be present in the second request");
        let MessageContent::ToolResults(ref parts) = tool_msg.content else {
            panic!("Tool message must have ToolResults content");
        };
        assert_eq!(parts.len(), 1);
        assert!(
            parts[0].content.contains("ghost_tool"),
            "tool result must identify the missing tool by name; got: {}",
            parts[0].content
        );
    }

    /// When the `ProviderRegistry` has no entry for the requested tier, the loop
    /// must return `AgentError::NoProvider` immediately — before any LLM call.
    #[tokio::test]
    async fn test_no_provider_for_tier_returns_agent_error_no_provider() {
        let registry = ProviderRegistry::new(); // intentionally empty
        let tools = ToolRegistry::new();

        let agent_loop = run_loop(&registry, &tools, 10);
        let result = agent_loop
            .run(
                Uuid::nil(),
                ProviderTier::Capable,
                "sys".into(),
                user_message("go"),
            )
            .await;

        assert!(result.is_err(), "missing provider must be an error");
        assert!(
            matches!(
                result.unwrap_err(),
                AgentError::NoProvider(ProviderTier::Capable)
            ),
            "error must be AgentError::NoProvider(Capable)"
        );
    }
}
