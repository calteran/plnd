pub(crate) mod memory;
pub(crate) use memory::register_memory_tools;

pub(crate) mod schedule;
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
}

// ── Registry factory ──────────────────────────────────────────────────────────

/// Build the `ToolRegistry` for a given [`UseCase`], creating stores directly
/// from the database pool.
///
/// Each use case registers only its own tool subset — task-entry tools are
/// never exposed to meal-planning runs, and vice versa.
pub(crate) fn build_tool_registry(
    use_case: &UseCase,
    db: &plnd_data::db::Database,
) -> ToolRegistry {
    let pool = db.get_pool().clone();
    let memory_store = Arc::new(plnd_data::db::MemoryStore::new(pool.clone()));
    let mut registry = ToolRegistry::new();
    register_memory_tools(&mut registry, memory_store);
    match use_case {
        UseCase::TaskEntry => {
            let task_store = Arc::new(plnd_data::db::TaskStore::new(pool.clone()));
            let schedule_store = Arc::new(plnd_data::db::ScheduleStore::new(pool));
            register_schedule_tools(&mut registry, task_store, schedule_store);
        }
        UseCase::MealPlanning
        | UseCase::MealRebalance
        | UseCase::MealSuggestSlot
        | UseCase::MealAdhocResolve => {}
    }
    registry
}
