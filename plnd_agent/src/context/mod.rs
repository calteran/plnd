use crate::provider::ProviderTier;

// Prompts are embedded at compile time so changes are git-diffable and
// bisectable like any other source change.
const TASK_ENTRY_PROMPT: &str = include_str!("../prompts/task_entry.md");
const MEAL_PLANNING_PROMPT: &str = include_str!("../prompts/meal_planning.md");

/// Identifies the type of agentic interaction.
///
/// Each variant maps to a system prompt and a [`ProviderTier`]. The tool
/// registry for a run is populated per use case — task-entry tools are never
/// exposed to meal-planning runs, and vice versa.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UseCase {
    /// User typed free-text describing a task ("replace vacuum filter").
    /// Agent infers properties and calls `create_task`.
    TaskEntry,

    /// User requested a weekly meal plan proposal.
    /// Agent searches the catalog and calls `propose_meal_plan`.
    MealPlanning,
}

impl UseCase {
    /// Returns the system prompt for this use case, embedded at compile time.
    pub fn system_prompt(&self) -> &'static str {
        match self {
            UseCase::TaskEntry => TASK_ENTRY_PROMPT,
            UseCase::MealPlanning => MEAL_PLANNING_PROMPT,
        }
    }

    /// Returns the [`ProviderTier`] to use for this use case.
    ///
    /// Both current use cases require the Capable tier for complex reasoning.
    /// Future background jobs (memory coalescing, pattern detection) will use
    /// the Fast tier.
    pub fn provider_tier(&self) -> ProviderTier {
        match self {
            UseCase::TaskEntry => ProviderTier::Capable,
            UseCase::MealPlanning => ProviderTier::Capable,
        }
    }
}
