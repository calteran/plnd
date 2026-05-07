use std::sync::LazyLock;

use crate::provider::ProviderTier;

// Prompts are embedded at compile time so changes are git-diffable and
// bisectable like any other source change.
const TASK_ENTRY_PROMPT: &str = include_str!("../prompts/task_entry.md");
const MEAL_PLANNING_PROMPT: &str = include_str!("../prompts/meal_planning.md");
const MEAL_REBALANCE_PROMPT: &str = include_str!("../prompts/meal_rebalance.md");
const MEAL_SUGGEST_SLOT_PROMPT: &str = include_str!("../prompts/meal_suggest_slot.md");
const MEAL_ADHOC_RESOLVE_PROMPT: &str = include_str!("../prompts/meal_adhoc_resolve.md");
const PLACE_TASKS_PROMPT: &str = include_str!("../prompts/place_tasks.md");

// ── Response schemas ─────────────────────────────────────────────────────────

/// JSON Schema (Draft 7) for the `TaskEntryResponse` type.
///
/// Enforces both structural and semantic constraints:
/// - Top-level shape: `actions_taken`, `ui_signals`, `confirmation` (no extra fields)
/// - When `actions_taken[i].type == "task_created"`, both `task_id` and
///   `date` must be present and non-null (the `if/then` conditional).
/// - `scheduled_at` is optional for all action types (used for timed tasks).
/// - `after_anchor` is optional (used for slot-scheduled tasks).
const TASK_ENTRY_RESPONSE_SCHEMA: &str = r##"{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TaskEntryResponse",
  "type": "object",
  "required": ["actions_taken", "ui_signals", "confirmation"],
  "additionalProperties": false,
  "properties": {
    "actions_taken": { "type": "array", "items": { "$ref": "#/definitions/ActionTaken" } },
    "ui_signals":    { "type": "array", "items": {} },
    "confirmation":  { "type": "string" }
  },
  "definitions": {
    "ActionTaken": {
      "type": "object",
      "required": ["type"],
      "additionalProperties": false,
      "properties": {
        "type":           { "type": "string" },
        "task_id":        { "oneOf": [{ "type": "string", "format": "uuid" }, { "type": "null" }] },
        "date":           { "oneOf": [{ "type": "string", "format": "date" }, { "type": "null" }] },
        "after_anchor": { "oneOf": [{ "type": "string" }, { "type": "null" }] },
        "scheduled_at":   { "oneOf": [{ "type": "string", "format": "date-time" }, { "type": "null" }] }
      },
      "if":   { "properties": { "type": { "const": "task_created" } }, "required": ["type"] },
      "then": {
        "required": ["task_id", "date"],
        "properties": {
          "task_id": { "type": "string", "format": "uuid" },
          "date":    { "type": "string", "format": "date" }
        }
      }
    }
  }
}"##;

/// Pre-compiled validator for [`TASK_ENTRY_RESPONSE_SCHEMA`].
///
/// Compiled once at first use and reused across all agent runs.
static TASK_ENTRY_VALIDATOR: LazyLock<jsonschema::Validator> = LazyLock::new(|| {
    let schema: serde_json::Value = serde_json::from_str(TASK_ENTRY_RESPONSE_SCHEMA)
        .expect("BUG: TASK_ENTRY_RESPONSE_SCHEMA is not valid JSON");
    jsonschema::options()
        .with_draft(jsonschema::Draft::Draft7)
        .should_validate_formats(true)
        .build(&schema)
        .expect("BUG: failed to compile TASK_ENTRY_RESPONSE_SCHEMA")
});

/// JSON Schema (Draft 7) for the `MealPlanResponse` type.
///
/// Validates the full-week proposal returned by `propose_meal_plan`.
/// `estimated_nutrition` and `nutrition_summary` are optional — the agent
/// may omit them when no nutrition data is available.
const MEAL_PLAN_RESPONSE_SCHEMA: &str = r##"{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MealPlanResponse",
  "type": "object",
  "required": ["plan_start", "meals"],
  "additionalProperties": false,
  "properties": {
    "plan_start":        { "type": "string", "format": "date" },
    "meals":             { "type": "array", "items": { "$ref": "#/definitions/MealEntry" } },
    "nutrition_summary": { "$ref": "#/definitions/NutritionSummary" }
  },
  "definitions": {
    "MealEntry": {
      "type": "object",
      "required": ["date", "meal_name", "meal_ref"],
      "additionalProperties": false,
      "properties": {
        "date":                 { "type": "string", "format": "date" },
        "meal_name":            { "type": "string", "description": "Name of the meal in the user's meal pattern (e.g. 'breakfast', 'lunch', 'dinner', or any user-defined name)" },
        "meal_ref":             { "$ref": "#/definitions/MealRef" },
        "estimated_nutrition":  { "$ref": "#/definitions/Nutrition" }
      }
    },
    "MealRef": {
      "type": "object",
      "required": ["type", "id"],
      "additionalProperties": false,
      "properties": {
        "type": { "type": "string", "enum": ["catalog", "user"] },
        "id":   { "type": "string", "format": "uuid" }
      }
    },
    "Nutrition": {
      "type": "object",
      "required": ["kcal", "protein_g", "carbs_g", "fat_g"],
      "additionalProperties": false,
      "properties": {
        "kcal":      { "type": "number" },
        "protein_g": { "type": "number" },
        "carbs_g":   { "type": "number" },
        "fat_g":     { "type": "number" }
      }
    },
    "NutritionSummary": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "avg_kcal":    { "type": "number" },
        "avg_protein": { "type": "number" },
        "flags":       { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}"##;

/// Pre-compiled validator for [`MEAL_PLAN_RESPONSE_SCHEMA`].
static MEAL_PLAN_VALIDATOR: LazyLock<jsonschema::Validator> = LazyLock::new(|| {
    let schema: serde_json::Value = serde_json::from_str(MEAL_PLAN_RESPONSE_SCHEMA)
        .expect("BUG: MEAL_PLAN_RESPONSE_SCHEMA is not valid JSON");
    jsonschema::options()
        .with_draft(jsonschema::Draft::Draft7)
        .should_validate_formats(true)
        .build(&schema)
        .expect("BUG: failed to compile MEAL_PLAN_RESPONSE_SCHEMA")
});

/// JSON Schema (Draft 7) for the `MealSuggestSlot` response — a single meal envelope.
const SUGGEST_SLOT_RESPONSE_SCHEMA: &str = r##"{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MealSuggestSlotResponse",
  "type": "object",
  "required": ["date", "meal_name", "meal_ref"],
  "additionalProperties": false,
  "properties": {
    "date":                { "type": "string", "format": "date" },
    "meal_name":           { "type": "string", "description": "Name of the meal in the user's meal pattern (e.g. 'breakfast', 'lunch', 'dinner', or any user-defined name)" },
    "meal_ref":            { "$ref": "#/definitions/MealRef" },
    "estimated_nutrition": { "$ref": "#/definitions/Nutrition" }
  },
  "definitions": {
    "MealRef": {
      "type": "object",
      "required": ["type", "id"],
      "additionalProperties": false,
      "properties": {
        "type": { "type": "string", "enum": ["catalog", "user"] },
        "id":   { "type": "string", "format": "uuid" }
      }
    },
    "Nutrition": {
      "type": "object",
      "required": ["kcal", "protein_g", "carbs_g", "fat_g"],
      "additionalProperties": false,
      "properties": {
        "kcal":      { "type": "number" },
        "protein_g": { "type": "number" },
        "carbs_g":   { "type": "number" },
        "fat_g":     { "type": "number" }
      }
    }
  }
}"##;

/// Pre-compiled validator for [`SUGGEST_SLOT_RESPONSE_SCHEMA`].
static SUGGEST_SLOT_VALIDATOR: LazyLock<jsonschema::Validator> = LazyLock::new(|| {
    let schema: serde_json::Value = serde_json::from_str(SUGGEST_SLOT_RESPONSE_SCHEMA)
        .expect("BUG: SUGGEST_SLOT_RESPONSE_SCHEMA is not valid JSON");
    jsonschema::options()
        .with_draft(jsonschema::Draft::Draft7)
        .should_validate_formats(true)
        .build(&schema)
        .expect("BUG: failed to compile SUGGEST_SLOT_RESPONSE_SCHEMA")
});

/// JSON Schema (Draft 7) for the `MealAdhocResolveResponse` type.
///
/// Three valid shapes:
/// - Catalog hit: `{ meal_ref: {type:"catalog", id:UUID}, confirmation }`
/// - User hit:    `{ meal_ref: {type:"user",    id:UUID}, confirmation }`
/// - New custom:  same as user hit, plus `estimated_nutrition`
const RESOLVE_RESPONSE_SCHEMA: &str = r##"{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MealAdhocResolveResponse",
  "type": "object",
  "required": ["meal_ref", "confirmation"],
  "additionalProperties": false,
  "properties": {
    "meal_ref":             { "$ref": "#/definitions/MealRef" },
    "estimated_nutrition":  { "$ref": "#/definitions/Nutrition" },
    "confirmation":         { "type": "string" }
  },
  "definitions": {
    "MealRef": {
      "type": "object",
      "required": ["type", "id"],
      "additionalProperties": false,
      "properties": {
        "type": { "type": "string", "enum": ["catalog", "user"] },
        "id":   { "type": "string", "format": "uuid" }
      }
    },
    "Nutrition": {
      "type": "object",
      "required": ["kcal", "protein_g", "carbs_g", "fat_g"],
      "additionalProperties": false,
      "properties": {
        "kcal":      { "type": "number" },
        "protein_g": { "type": "number" },
        "carbs_g":   { "type": "number" },
        "fat_g":     { "type": "number" }
      }
    }
  }
}"##;

/// Pre-compiled validator for [`RESOLVE_RESPONSE_SCHEMA`].
static RESOLVE_VALIDATOR: LazyLock<jsonschema::Validator> = LazyLock::new(|| {
    let schema: serde_json::Value = serde_json::from_str(RESOLVE_RESPONSE_SCHEMA)
        .expect("BUG: RESOLVE_RESPONSE_SCHEMA is not valid JSON");
    jsonschema::options()
        .with_draft(jsonschema::Draft::Draft7)
        .should_validate_formats(true)
        .build(&schema)
        .expect("BUG: failed to compile RESOLVE_RESPONSE_SCHEMA")
});

/// JSON Schema (Draft 7) for the `PlaceTasksResponse` type.
///
/// The agent's `place_tasks` terminal tool wraps entries in `{"entries": [...]}`
/// because the Anthropic API requires tool input schemas to be `type: object`.
/// This schema validates that exact shape; the handler unwraps `entries` before
/// returning the flat array to the client.
const PLACE_TASKS_RESPONSE_SCHEMA: &str = r##"{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PlaceTasksResponse",
  "type": "object",
  "required": ["entries"],
  "additionalProperties": false,
  "properties": {
    "entries": {
      "type": "array",
      "items": { "$ref": "#/definitions/PlacedTask" }
    }
  },
  "definitions": {
    "PlacedTask": {
      "type": "object",
      "required": ["title", "scheduled_date", "duration_minutes", "energy_required", "task_type"],
      "additionalProperties": false,
      "properties": {
        "title":             { "type": "string" },
        "scheduled_date":    { "type": "string", "format": "date" },
        "task_type":         { "type": "string", "enum": ["work", "exercise", "leisure", "appointment", "medication", "general"] },
        "duration_minutes":  { "type": "integer", "minimum": 1, "maximum": 480 },
        "energy_required":   { "type": "string", "enum": ["low", "medium", "high"] },
        "after_anchor":      { "type": "string" },
        "time_window_start": { "type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
        "one_shot":          { "type": "boolean" }
      }
    }
  }
}"##;

/// Pre-compiled validator for [`PLACE_TASKS_RESPONSE_SCHEMA`].
static PLACE_TASKS_VALIDATOR: LazyLock<jsonschema::Validator> = LazyLock::new(|| {
    let schema: serde_json::Value = serde_json::from_str(PLACE_TASKS_RESPONSE_SCHEMA)
        .expect("BUG: PLACE_TASKS_RESPONSE_SCHEMA is not valid JSON");
    jsonschema::options()
        .with_draft(jsonschema::Draft::Draft7)
        .should_validate_formats(true)
        .build(&schema)
        .expect("BUG: failed to compile PLACE_TASKS_RESPONSE_SCHEMA")
});

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

    /// Agent suggests a meal for a specific open slot (user triggered or auto).
    MealSuggestSlot,
    /// Agent resolves an ad-hoc meal the user described (not in their plan).
    MealAdhocResolve,
    /// Agent receives comma-separated task names + date range and returns one
    /// scheduled placement per task (date, time, duration, energy level).
    /// No DB writes; the client commits via `POST /schedule/plan`.
    PlaceTasks,
}

impl UseCase {
    /// Returns the system prompt for this use case, embedded at compile time.
    pub fn system_prompt(&self) -> &'static str {
        match self {
            UseCase::TaskEntry => TASK_ENTRY_PROMPT,
            UseCase::MealPlanning => MEAL_PLANNING_PROMPT,
            UseCase::MealRebalance => MEAL_REBALANCE_PROMPT,
            UseCase::MealSuggestSlot => MEAL_SUGGEST_SLOT_PROMPT,
            UseCase::MealAdhocResolve => MEAL_ADHOC_RESOLVE_PROMPT,
            UseCase::PlaceTasks => PLACE_TASKS_PROMPT,
        }
    }

    /// Returns the memory categories to load from the DB for this use case.
    ///
    /// Memories are filtered to these categories before being injected into the
    /// system prompt, keeping the context focused and relevant.
    pub fn memory_categories(&self) -> &'static [&'static str] {
        match self {
            UseCase::TaskEntry => &["habits", "schedule", "energy"],
            UseCase::MealPlanning
            | UseCase::MealRebalance
            | UseCase::MealSuggestSlot
            | UseCase::MealAdhocResolve => &["food", "habits"],
            UseCase::PlaceTasks => &["habits", "schedule", "energy"],
        }
    }

    /// Returns the [`ProviderTier`] to use for this use case.
    ///
    /// All current use cases require the Capable tier for complex reasoning.
    /// Future background jobs (memory coalescing, pattern detection) will use
    /// the Fast tier.
    pub fn provider_tier(&self) -> ProviderTier {
        match self {
            UseCase::TaskEntry
            | UseCase::MealPlanning
            | UseCase::MealRebalance
            | UseCase::MealSuggestSlot
            | UseCase::MealAdhocResolve
            | UseCase::PlaceTasks => ProviderTier::Capable,
        }
    }

    /// Returns the compiled JSON Schema validator for this use case, if one is defined.
    ///
    /// The validator is compiled from a `&'static str` schema exactly once (via
    /// [`LazyLock`]) and reused across all agent runs. `None` means no response
    /// contract is enforced for this use case yet.
    ///
    /// Validation is called in [`crate::agent::AgentService::run`] after the
    /// agent loop completes, before returning [`crate::agent::AgentOutput`].
    pub fn response_validator(&self) -> Option<&'static jsonschema::Validator> {
        match self {
            UseCase::TaskEntry => Some(&TASK_ENTRY_VALIDATOR),
            UseCase::MealPlanning | UseCase::MealRebalance => Some(&MEAL_PLAN_VALIDATOR),
            UseCase::MealSuggestSlot => Some(&SUGGEST_SLOT_VALIDATOR),
            UseCase::MealAdhocResolve => Some(&RESOLVE_VALIDATOR),
            UseCase::PlaceTasks => Some(&PLACE_TASKS_VALIDATOR),
        }
    }
}

/// Bundles all inputs for a single agentic run.
///
/// Constructed by the caller before invoking [`AgentService::run`]. The
/// `user_id` comes from the authenticated session — never from the LLM.
#[derive(Debug, Clone, PartialEq)]
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
    /// Structured extra data for tools that need request-scoped state.
    /// Passed to `build_tool_registry` so tools can be constructed with it.
    /// Only `UseCase::MealPlanning` currently uses this (week schedule state).
    pub extra: Option<serde_json::Value>,
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
            UseCase::MealSuggestSlot,
            UseCase::MealAdhocResolve,
            UseCase::PlaceTasks,
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
            UseCase::MealSuggestSlot,
            UseCase::MealAdhocResolve,
            UseCase::PlaceTasks,
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
    fn task_entry_has_response_validator() {
        assert!(UseCase::TaskEntry.response_validator().is_some());
    }

    #[test]
    fn meal_rebalance_has_response_validator() {
        assert!(UseCase::MealRebalance.response_validator().is_some());
    }

    #[test]
    fn meal_adhoc_resolve_has_response_validator() {
        assert!(UseCase::MealAdhocResolve.response_validator().is_some());
    }

    #[test]
    fn resolve_validator_accepts_catalog_hit() {
        let v = UseCase::MealAdhocResolve.response_validator().unwrap();
        let ok = serde_json::json!({
            "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
            "confirmation": "Matched grilled cheese in catalog."
        });
        assert!(v.is_valid(&ok));
    }

    #[test]
    fn resolve_validator_accepts_new_with_nutrition() {
        let v = UseCase::MealAdhocResolve.response_validator().unwrap();
        let ok = serde_json::json!({
            "meal_ref": { "type": "user", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
            "estimated_nutrition": { "kcal": 350.0, "protein_g": 15.0, "carbs_g": 40.0, "fat_g": 10.0 },
            "confirmation": "Created custom grilled cheese with estimated nutrition."
        });
        assert!(v.is_valid(&ok));
    }

    #[test]
    fn resolve_validator_rejects_missing_confirmation() {
        let v = UseCase::MealAdhocResolve.response_validator().unwrap();
        let bad = serde_json::json!({
            "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
        });
        assert!(!v.is_valid(&bad));
    }

    #[test]
    fn resolve_validator_rejects_missing_meal_ref() {
        let v = UseCase::MealAdhocResolve.response_validator().unwrap();
        let bad = serde_json::json!({ "confirmation": "done" });
        assert!(!v.is_valid(&bad));
    }

    #[test]
    fn resolve_validator_rejects_extra_properties() {
        let v = UseCase::MealAdhocResolve.response_validator().unwrap();
        let bad = serde_json::json!({
            "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
            "confirmation": "ok",
            "surprise_field": "boom"
        });
        assert!(!v.is_valid(&bad));
    }

    #[test]
    fn suggest_slot_has_response_validator() {
        assert!(UseCase::MealSuggestSlot.response_validator().is_some());
    }

    #[test]
    fn suggest_slot_validator_accepts_minimal_valid_envelope() {
        let validator = UseCase::MealSuggestSlot.response_validator().unwrap();
        let ok = serde_json::json!({
            "date": "2026-04-21",
            "meal_name": "lunch",
            "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
        });
        assert!(validator.is_valid(&ok), "minimal valid envelope must pass");
    }

    #[test]
    fn suggest_slot_validator_accepts_envelope_with_nutrition() {
        let validator = UseCase::MealSuggestSlot.response_validator().unwrap();
        let ok = serde_json::json!({
            "date": "2026-04-21",
            "meal_name": "dinner",
            "meal_ref": { "type": "user", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
            "estimated_nutrition": { "kcal": 520.0, "protein_g": 28.0, "carbs_g": 45.0, "fat_g": 18.0 }
        });
        assert!(validator.is_valid(&ok));
    }

    #[test]
    fn suggest_slot_validator_rejects_missing_meal_ref() {
        let validator = UseCase::MealSuggestSlot.response_validator().unwrap();
        let bad = serde_json::json!({ "date": "2026-04-21", "meal_name": "lunch" });
        assert!(!validator.is_valid(&bad));
    }

    #[test]
    fn suggest_slot_validator_accepts_user_defined_meal_name() {
        // meal_name is an open string — any name from the user's meal pattern is valid
        let validator = UseCase::MealSuggestSlot.response_validator().unwrap();
        let ok = serde_json::json!({
            "date": "2026-04-21",
            "meal_name": "brunch",
            "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
        });
        assert!(
            validator.is_valid(&ok),
            "user-defined meal name must be accepted"
        );
    }

    #[test]
    fn meal_planning_has_response_validator() {
        assert!(UseCase::MealPlanning.response_validator().is_some());
    }

    #[test]
    fn meal_plan_validator_accepts_minimal_valid_plan() {
        let validator = UseCase::MealPlanning.response_validator().unwrap();
        let ok = serde_json::json!({
            "plan_start": "2026-04-21",
            "meals": [
                {
                    "date": "2026-04-21",
                    "meal_name": "breakfast",
                    "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
                }
            ]
        });
        assert!(validator.is_valid(&ok), "minimal valid plan must pass");
    }

    #[test]
    fn meal_plan_validator_accepts_plan_with_nutrition() {
        let validator = UseCase::MealPlanning.response_validator().unwrap();
        let ok = serde_json::json!({
            "plan_start": "2026-04-21",
            "meals": [
                {
                    "date": "2026-04-21",
                    "meal_name": "lunch",
                    "meal_ref": { "type": "user", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
                    "estimated_nutrition": { "kcal": 420.0, "protein_g": 18.0, "carbs_g": 55.0, "fat_g": 12.0 }
                }
            ],
            "nutrition_summary": { "avg_kcal": 420.0, "avg_protein": 18.0, "flags": [] }
        });
        assert!(
            validator.is_valid(&ok),
            "plan with optional nutrition must pass"
        );
    }

    #[test]
    fn meal_plan_validator_rejects_missing_plan_start() {
        let validator = UseCase::MealPlanning.response_validator().unwrap();
        let bad = serde_json::json!({ "meals": [] });
        assert!(!validator.is_valid(&bad));
    }

    #[test]
    fn meal_plan_validator_accepts_user_defined_meal_name() {
        // meal_name is an open string — any name from the user's meal pattern is valid
        let validator = UseCase::MealPlanning.response_validator().unwrap();
        let ok = serde_json::json!({
            "plan_start": "2026-04-21",
            "meals": [
                {
                    "date": "2026-04-21",
                    "meal_name": "brunch",
                    "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
                }
            ]
        });
        assert!(
            validator.is_valid(&ok),
            "user-defined meal name must be accepted"
        );
    }

    #[test]
    fn meal_plan_validator_rejects_extra_properties() {
        let validator = UseCase::MealPlanning.response_validator().unwrap();
        let bad = serde_json::json!({
            "plan_start": "2026-04-21",
            "meals": [],
            "unexpected_field": "boom"
        });
        assert!(!validator.is_valid(&bad));
    }

    #[test]
    fn task_entry_validator_is_accessible() {
        // Triggers LazyLock initialisation and confirms it doesn't panic.
        let validator = UseCase::TaskEntry.response_validator().unwrap();
        // A trivially correct response should pass.
        let ok: serde_json::Value = serde_json::json!({
            "actions_taken": [],
            "ui_signals": [],
            "confirmation": ""
        });
        assert!(validator.is_valid(&ok));
    }

    #[test]
    fn task_entry_validator_accepts_bucket_task_created() {
        let validator = UseCase::TaskEntry.response_validator().unwrap();
        let ok: serde_json::Value = serde_json::json!({
            "actions_taken": [{
                "type": "task_created",
                "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "date": "2026-04-10",
                "after_anchor": "after_lunch"
            }],
            "ui_signals": [],
            "confirmation": "Scheduled after lunch on Thursday."
        });
        assert!(validator.is_valid(&ok));
    }

    #[test]
    fn task_entry_validator_accepts_timed_task_created() {
        let validator = UseCase::TaskEntry.response_validator().unwrap();
        let ok: serde_json::Value = serde_json::json!({
            "actions_taken": [{
                "type": "task_created",
                "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "date": "2026-04-10",
                "scheduled_at": "2026-04-10T14:00:00Z"
            }],
            "ui_signals": [],
            "confirmation": "Scheduled for 2:00 PM Thursday."
        });
        assert!(validator.is_valid(&ok));
    }

    #[test]
    fn task_entry_validator_rejects_scheduled_start_field_name() {
        let validator = UseCase::TaskEntry.response_validator().unwrap();
        // The tool previously emitted "scheduled_start" — this must be rejected
        // because ActionTaken has additionalProperties: false and only defines
        // "scheduled_at".
        let bad: serde_json::Value = serde_json::json!({
            "actions_taken": [{
                "type": "task_created",
                "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "date": "2026-04-09",
                "scheduled_start": "2026-04-09T09:00:00Z"
            }],
            "ui_signals": [],
            "confirmation": "Scheduled."
        });
        assert!(!validator.is_valid(&bad));
    }

    #[test]
    fn task_entry_validator_rejects_task_created_without_date() {
        let validator = UseCase::TaskEntry.response_validator().unwrap();
        // task_created requires both task_id and date — missing date must fail
        let bad: serde_json::Value = serde_json::json!({
            "actions_taken": [{
                "type": "task_created",
                "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "scheduled_at": "2026-04-10T14:00:00Z"
            }],
            "ui_signals": [],
            "confirmation": "Scheduled."
        });
        assert!(!validator.is_valid(&bad));
    }

    #[test]
    fn all_use_cases_use_capable_tier() {
        for case in [
            UseCase::TaskEntry,
            UseCase::MealPlanning,
            UseCase::MealRebalance,
            UseCase::MealSuggestSlot,
            UseCase::MealAdhocResolve,
            UseCase::PlaceTasks,
        ] {
            assert_eq!(
                case.provider_tier(),
                ProviderTier::Capable,
                "{case:?} should use Capable tier"
            );
        }
    }

    #[test]
    fn place_tasks_has_response_validator() {
        assert!(UseCase::PlaceTasks.response_validator().is_some());
    }

    #[test]
    fn place_tasks_validator_accepts_floating_entry() {
        let v = UseCase::PlaceTasks.response_validator().unwrap();
        let ok = serde_json::json!({
            "entries": [{
                "title": "Call dentist",
                "scheduled_date": "2026-04-23",
                "after_anchor": "lunch",
                "duration_minutes": 30,
                "energy_required": "low",
                "task_type": "appointment"
            }]
        });
        assert!(v.is_valid(&ok));
    }

    #[test]
    fn place_tasks_validator_accepts_fixed_entry() {
        let v = UseCase::PlaceTasks.response_validator().unwrap();
        let ok = serde_json::json!({
            "entries": [{
                "title": "Doctor appointment",
                "scheduled_date": "2026-04-23",
                "time_window_start": "10:00",
                "duration_minutes": 60,
                "energy_required": "medium",
                "task_type": "appointment"
            }]
        });
        assert!(v.is_valid(&ok));
    }

    #[test]
    fn place_tasks_validator_accepts_empty_entries() {
        let v = UseCase::PlaceTasks.response_validator().unwrap();
        let ok = serde_json::json!({ "entries": [] });
        assert!(v.is_valid(&ok));
    }

    #[test]
    fn place_tasks_validator_rejects_invalid_energy_level() {
        let v = UseCase::PlaceTasks.response_validator().unwrap();
        let bad = serde_json::json!({
            "entries": [{
                "title": "Task",
                "scheduled_date": "2026-04-23",
                "after_anchor": "lunch",
                "duration_minutes": 30,
                "energy_required": "extreme",
                "task_type": "work"
            }]
        });
        assert!(!v.is_valid(&bad));
    }

    #[test]
    fn place_tasks_validator_rejects_invalid_task_type() {
        let v = UseCase::PlaceTasks.response_validator().unwrap();
        let bad = serde_json::json!({
            "entries": [{
                "title": "Task",
                "scheduled_date": "2026-04-23",
                "after_anchor": "breakfast",
                "duration_minutes": 30,
                "energy_required": "low",
                "task_type": "floating"
            }]
        });
        assert!(!v.is_valid(&bad));
    }

    #[test]
    fn place_tasks_validator_rejects_duration_zero() {
        let v = UseCase::PlaceTasks.response_validator().unwrap();
        let bad = serde_json::json!({
            "entries": [{
                "title": "Task",
                "scheduled_date": "2026-04-23",
                "after_anchor": "lunch",
                "duration_minutes": 0,
                "energy_required": "low",
                "task_type": "work"
            }]
        });
        assert!(!v.is_valid(&bad));
    }

    #[test]
    fn place_tasks_validator_accepts_entry_without_time_anchor() {
        // Neither time_window_start nor after_anchor is required by the schema;
        // the agent prompt instructs one should always be present, but the schema
        // itself doesn't enforce mutual exclusion.
        let v = UseCase::PlaceTasks.response_validator().unwrap();
        let ok = serde_json::json!({
            "entries": [{
                "title": "Task",
                "scheduled_date": "2026-04-23",
                "duration_minutes": 30,
                "energy_required": "low",
                "task_type": "work"
            }]
        });
        assert!(v.is_valid(&ok));
    }

    #[test]
    fn place_tasks_validator_rejects_extra_properties() {
        let v = UseCase::PlaceTasks.response_validator().unwrap();
        let bad = serde_json::json!({
            "entries": [{
                "title": "Task",
                "scheduled_date": "2026-04-23",
                "after_anchor": "lunch",
                "duration_minutes": 30,
                "energy_required": "low",
                "task_type": "work",
                "surprise": "boom"
            }]
        });
        assert!(!v.is_valid(&bad));
    }

    #[test]
    fn place_tasks_validator_accepts_any_slot_label() {
        let v = &PLACE_TASKS_VALIDATOR;
        for label in &["brunch", "morning snack", "post-workout", "start_of_day"] {
            let payload = serde_json::json!({
                "entries": [{
                    "title": "Task",
                    "scheduled_date": "2026-04-23",
                    "after_anchor": label,
                    "duration_minutes": 30,
                    "energy_required": "low",
                    "task_type": "work"
                }]
            });
            assert!(
                v.is_valid(&payload),
                "slot label '{}' must be accepted",
                label
            );
        }
    }

    #[test]
    fn place_tasks_validator_rejects_non_time_string_in_time_window_start() {
        let v = UseCase::PlaceTasks.response_validator().unwrap();
        for bad_time in ["lunch", "25:00", "24:00", "29:59", "99:99"] {
            let bad = serde_json::json!({
                "entries": [{
                    "title": "Task",
                    "scheduled_date": "2026-04-23",
                    "time_window_start": bad_time,
                    "duration_minutes": 30,
                    "energy_required": "low",
                    "task_type": "work"
                }]
            });
            assert!(
                !v.is_valid(&bad),
                "expected rejection for time_window_start={bad_time}"
            );
        }
    }

    #[test]
    fn place_tasks_validator_accepts_valid_hhmm_time_window_start() {
        let v = UseCase::PlaceTasks.response_validator().unwrap();
        for good_time in ["00:00", "09:00", "14:30", "23:59"] {
            let ok = serde_json::json!({
                "entries": [{
                    "title": "Doctor appointment",
                    "scheduled_date": "2026-04-23",
                    "time_window_start": good_time,
                    "duration_minutes": 60,
                    "energy_required": "medium",
                    "task_type": "appointment"
                }]
            });
            assert!(
                v.is_valid(&ok),
                "expected acceptance for time_window_start={good_time}"
            );
        }
    }
}
