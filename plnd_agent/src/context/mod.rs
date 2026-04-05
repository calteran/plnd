use crate::provider::ProviderTier;

// Prompts are embedded at compile time so changes are git-diffable and
// bisectable like any other source change.
const TASK_ENTRY_PROMPT: &str = include_str!("../prompts/task_entry.md");
const MEAL_PLANNING_PROMPT: &str = include_str!("../prompts/meal_planning.md");
const MEAL_REBALANCE_PROMPT: &str = include_str!("../prompts/meal_rebalance.md");

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

    /// User pinned or unpinned a meal slot; agent rebalances remaining open slots.
    /// Agent calls `rebalance_meal_plan` as its terminal action.
    MealRebalance,
}

impl UseCase {
    /// Returns the system prompt for this use case, embedded at compile time.
    pub fn system_prompt(&self) -> &'static str {
        match self {
            UseCase::TaskEntry => TASK_ENTRY_PROMPT,
            UseCase::MealPlanning => MEAL_PLANNING_PROMPT,
            UseCase::MealRebalance => MEAL_REBALANCE_PROMPT,
        }
    }

    /// Returns the memory categories to load from the DB for this use case.
    ///
    /// Memories are filtered to these categories before being injected into the
    /// system prompt, keeping the context focused and relevant.
    pub fn memory_categories(&self) -> &'static [&'static str] {
        match self {
            UseCase::TaskEntry => &["habits", "schedule", "energy"],
            UseCase::MealPlanning => &["food", "habits"],
            UseCase::MealRebalance => &["food", "habits"],
        }
    }

    /// Returns the [`ProviderTier`] to use for this use case.
    ///
    /// All current use cases require the Capable tier for complex reasoning.
    /// Future background jobs (memory coalescing, pattern detection) will use
    /// the Fast tier.
    pub fn provider_tier(&self) -> ProviderTier {
        match self {
            UseCase::TaskEntry => ProviderTier::Capable,
            UseCase::MealPlanning => ProviderTier::Capable,
            UseCase::MealRebalance => ProviderTier::Capable,
        }
    }
}

/// Bundles all inputs for a single agentic run.
///
/// Constructed by the caller before invoking [`AgentService::run`]. The
/// `user_id` comes from the authenticated session — never from the LLM.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentContext {
    /// Authenticated user making the request.
    pub user_id: uuid::Uuid,
    /// Which use case this run executes.
    pub use_case: UseCase,
    /// Raw user input that will be wrapped in `<user_input>` delimiters by the agent runner.
    pub input: String,
    /// Trusted system context (e.g. prior conversation turns). Prepended *before* the
    /// `<user_input>` wrapper so the model treats it as trusted system data, not user input.
    pub prior_context: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_prompts_are_non_empty() {
        for case in [
            UseCase::TaskEntry,
            UseCase::MealPlanning,
            UseCase::MealRebalance,
        ] {
            assert!(
                !case.system_prompt().is_empty(),
                "{case:?} system prompt is empty"
            );
        }
    }

    #[test]
    fn system_prompts_contain_security_guard() {
        for case in [
            UseCase::TaskEntry,
            UseCase::MealPlanning,
            UseCase::MealRebalance,
        ] {
            assert!(
                case.system_prompt().contains("<user_input>"),
                "{case:?} prompt missing <user_input> security delimiter"
            );
        }
    }

    #[test]
    fn meal_rebalance_prompt_mentions_rebalance() {
        assert!(UseCase::MealRebalance.system_prompt().contains("rebalance"));
    }

    #[test]
    fn task_entry_categories_exclude_food() {
        let cats = UseCase::TaskEntry.memory_categories();
        assert!(cats.contains(&"habits"), "TaskEntry must include habits");
        assert!(
            cats.contains(&"schedule"),
            "TaskEntry must include schedule"
        );
        assert!(cats.contains(&"energy"), "TaskEntry must include energy");
        assert!(!cats.contains(&"food"), "TaskEntry must not include food");
    }

    #[test]
    fn meal_planning_categories_exclude_schedule() {
        let cats = UseCase::MealPlanning.memory_categories();
        assert!(cats.contains(&"food"), "MealPlanning must include food");
        assert!(cats.contains(&"habits"), "MealPlanning must include habits");
        assert!(
            !cats.contains(&"schedule"),
            "MealPlanning must not include schedule"
        );
        assert!(
            !cats.contains(&"energy"),
            "MealPlanning must not include energy"
        );
    }

    #[test]
    fn all_use_cases_use_capable_tier() {
        for case in [
            UseCase::TaskEntry,
            UseCase::MealPlanning,
            UseCase::MealRebalance,
        ] {
            assert_eq!(
                case.provider_tier(),
                ProviderTier::Capable,
                "{case:?} should use Capable tier"
            );
        }
    }
}
