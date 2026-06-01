pub(crate) mod meal;
pub(crate) use meal::register_meal_adhoc_resolve_tools;
pub(crate) use meal::register_meal_read_tools;
pub(crate) use meal::register_meal_rebalance_tools;
pub(crate) use meal::register_meal_slot_read_tools;
pub(crate) use meal::register_meal_suggest_slot_tools;

pub(crate) mod memory;
pub(crate) use memory::register_memory_tools;

pub(crate) mod schedule;
pub(crate) use schedule::register_place_tasks_tools;
pub(crate) use schedule::register_schedule_tools;

use std::collections::HashMap;
use std::sync::Arc;

use uuid::Uuid;

use crate::context::UseCase;
use crate::provider::ToolDefinition;

// ── Error ─────────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("Tool not found: {0}")]
    NotFound(String),

    #[error("Invalid input for tool '{tool}': {reason}")]
    InvalidInput { tool: String, reason: String },

    #[error("Execution failed for tool '{tool}': {reason}")]
    Execution { tool: String, reason: String },
}

// ── ToolContext ───────────────────────────────────────────────────────────────

/// Security boundary: `user_id` is always sourced from the authenticated
/// session and passed through to every tool call.
///
/// Tools never accept `user_id` from LLM-supplied `input` — it must come
/// from here so the LLM cannot escalate privileges or access other users' data.
#[derive(Debug, Clone)]
pub struct ToolContext {
    pub user_id: Uuid,
}

// ── Tool trait ────────────────────────────────────────────────────────────────

/// A tool that the agentic loop can invoke.
///
/// Implementations live in `plnd_agent/src/tools/` and hold references to
/// `plnd_data` repositories directly — no injection through `plnd_api`.
#[async_trait::async_trait]
pub trait Tool: Send + Sync {
    /// Short, unique machine-readable name used to identify this tool in LLM
    /// calls and in [`ToolRegistry`] lookup.
    fn name(&self) -> &str;

    /// Human-readable description shown to the LLM to guide tool selection.
    fn description(&self) -> &str;

    /// JSON Schema object describing the tool's `input` parameter.
    fn schema(&self) -> serde_json::Value;

    /// Whether invoking this tool signals that the agentic loop is complete.
    ///
    /// When a terminal tool appears in a tool-call batch, the loop executes all
    /// tools in that batch in parallel then stops — the terminal tool's result
    /// becomes the final [`AgentOutput`][crate::agent::AgentOutput].
    fn is_terminal(&self) -> bool {
        false
    }

    /// Execute the tool with the given `input` under the security context `ctx`.
    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError>;
}

// ── ToolRegistry ──────────────────────────────────────────────────────────────

/// Registry of tools available to an agentic run.
///
/// Each [`UseCase`][crate::context::UseCase] registers only its own tool subset
/// — task-entry tools are never exposed to meal-planning runs, and vice versa.
///
/// Tools are stored as `Arc<dyn Tool>` so they can be shared across parallel
/// `tokio::task::JoinSet` spawns without cloning the tool itself.
#[derive(Default)]
pub(crate) struct ToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    /// Register a tool. Overwrites any existing tool with the same name.
    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    /// Returns [`ToolDefinition`] entries for every registered tool, suitable
    /// for embedding in a [`CompletionRequest`][crate::provider::CompletionRequest].
    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.tools
            .values()
            .map(|t| ToolDefinition {
                name: t.name().to_string(),
                description: t.description().to_string(),
                schema: t.schema(),
            })
            .collect()
    }

    /// Look up a tool by name and return a cheap `Arc` clone of it.
    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    /// Returns `true` if the named tool is registered and [`Tool::is_terminal`]
    /// returns `true` for it.
    pub fn is_terminal(&self, name: &str) -> bool {
        self.tools
            .get(name)
            .map(|t| t.is_terminal())
            .unwrap_or(false)
    }

    /// Returns the name of the sole registered terminal tool, if exactly one
    /// exists.  Returns `None` when zero or multiple terminal tools are
    /// registered — the latter case is ambiguous, so the caller falls back to
    /// a generic correction message.
    pub fn terminal_tool_name(&self) -> Option<&str> {
        let mut terminals = self.tools.values().filter(|t| t.is_terminal());
        let first = terminals.next()?;
        if terminals.next().is_some() {
            return None;
        }
        Some(first.name())
    }
}

// ── Registry factory ──────────────────────────────────────────────────────────

/// Build the `ToolRegistry` for a given [`UseCase`].
///
/// Each use case registers only its own tool subset — task-entry tools are
/// never exposed to meal-planning runs, and vice versa.
pub(crate) fn build_tool_registry(
    use_case: &UseCase,
    repos: &plnd_data::Repositories,
    extra: Option<serde_json::Value>,
) -> ToolRegistry {
    let mut registry = ToolRegistry::new();
    // PlaceTasks and ReviewMealPlan skip memory tools: both have all context
    // pre-assembled into prior_context, so memory tool calls add only token
    // overhead (~400–500 tokens) with no benefit.
    if *use_case != UseCase::PlaceTasks && *use_case != UseCase::ReviewMealPlan {
        register_memory_tools(&mut registry, Arc::clone(&repos.memory));
    }
    match use_case {
        UseCase::TaskEntry => {
            register_schedule_tools(
                &mut registry,
                Arc::clone(&repos.task),
                Arc::clone(&repos.schedule),
                Arc::clone(&repos.meal_anchor_instance),
            );
        }
        UseCase::MealRebalance => {
            register_meal_read_tools(
                &mut registry,
                Arc::clone(&repos.meal),
                Arc::clone(&repos.user_ingredient_pref),
                Arc::clone(&repos.user_meal_pref),
            );
            let week_state = extra.unwrap_or_default();
            register_meal_rebalance_tools(&mut registry, week_state);
        }
        UseCase::MealSuggestSlot => {
            register_meal_slot_read_tools(
                &mut registry,
                Arc::clone(&repos.meal),
                Arc::clone(&repos.user_ingredient_pref),
                Arc::clone(&repos.user_meal_pref),
            );
            register_meal_suggest_slot_tools(&mut registry);
        }
        UseCase::MealAdhocResolve => {
            register_meal_read_tools(
                &mut registry,
                Arc::clone(&repos.meal),
                Arc::clone(&repos.user_ingredient_pref),
                Arc::clone(&repos.user_meal_pref),
            );
            register_meal_adhoc_resolve_tools(&mut registry, Arc::clone(&repos.user_meal_pref));
        }
        UseCase::PlaceTasks => {
            register_place_tasks_tools(&mut registry);
        }
        // ReviewMealPlan receives the full plan via prior_context; no tools needed.
        UseCase::ReviewMealPlan => {}
    }
    registry
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    struct NonTerminalTool;

    #[async_trait::async_trait]
    impl Tool for NonTerminalTool {
        fn name(&self) -> &str {
            "non_terminal"
        }
        fn description(&self) -> &str {
            ""
        }
        fn schema(&self) -> serde_json::Value {
            serde_json::json!({})
        }
        async fn execute(
            &self,
            _ctx: &ToolContext,
            _input: serde_json::Value,
        ) -> Result<serde_json::Value, ToolError> {
            Ok(serde_json::json!({}))
        }
    }

    struct MyTerminalTool;

    #[async_trait::async_trait]
    impl Tool for MyTerminalTool {
        fn name(&self) -> &str {
            "submit_result"
        }
        fn description(&self) -> &str {
            ""
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
            Ok(serde_json::json!({}))
        }
    }

    struct AnotherTerminalTool;

    #[async_trait::async_trait]
    impl Tool for AnotherTerminalTool {
        fn name(&self) -> &str {
            "another_terminal"
        }
        fn description(&self) -> &str {
            ""
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
            Ok(serde_json::json!({}))
        }
    }

    #[test]
    fn terminal_tool_name_returns_none_when_no_terminal_tool() {
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(NonTerminalTool));
        assert_eq!(registry.terminal_tool_name(), None);
    }

    #[test]
    fn terminal_tool_name_returns_name_when_terminal_tool_registered() {
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(NonTerminalTool));
        registry.register(Arc::new(MyTerminalTool));
        assert_eq!(registry.terminal_tool_name(), Some("submit_result"));
    }

    #[test]
    fn terminal_tool_name_returns_none_for_empty_registry() {
        let registry = ToolRegistry::new();
        assert_eq!(registry.terminal_tool_name(), None);
    }

    #[test]
    fn terminal_tool_name_returns_none_when_multiple_terminal_tools() {
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(MyTerminalTool));
        registry.register(Arc::new(AnotherTerminalTool));
        assert_eq!(registry.terminal_tool_name(), None);
    }
}
