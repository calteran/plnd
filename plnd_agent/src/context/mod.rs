use std::sync::LazyLock;

use crate::provider::ProviderTier;

// Prompts are embedded at compile time so changes are git-diffable and
// bisectable like any other source change.
const TASK_ENTRY_PROMPT: &str = include_str!("../prompts/task_entry.md");
const MEAL_PLANNING_PROMPT: &str = include_str!("../prompts/meal_planning.md");
const MEAL_REBALANCE_PROMPT: &str = include_str!("../prompts/meal_rebalance.md");
const MEAL_SUGGEST_SLOT_PROMPT: &str = include_str!("../prompts/meal_suggest_slot.md");
const MEAL_ADHOC_RESOLVE_PROMPT: &str = include_str!("../prompts/meal_adhoc_resolve.md");

// ── Response schemas ─────────────────────────────────────────────────────────

/// JSON Schema (Draft 7) for the `TaskEntryResponse` type.
///
/// Enforces both structural and semantic constraints:
/// - Top-level shape: `actions_taken`, `ui_signals`, `confirmation` (no extra fields)
/// - When `actions_taken[i].type == "task_created"`, both `task_id` and
///   `date` must be present and non-null (the `if/then` conditional).
/// - `scheduled_at` is optional for all action types (used for timed tasks).
/// - `after_milepost` is optional (used for bucket-scheduled tasks).
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
        "after_milepost": { "oneOf": [{ "type": "string" }, { "type": "null" }] },
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
      "required": ["date", "occasion", "meal_ref"],
      "additionalProperties": false,
      "properties": {
        "date":                 { "type": "string", "format": "date" },
        "occasion":             { "type": "string", "enum": ["breakfast", "lunch", "dinner", "snack"] },
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
  "required": ["date", "occasion", "meal_ref"],
  "additionalProperties": false,
  "properties": {
    "date":                { "type": "string", "format": "date" },
    "occasion":            { "type": "string", "enum": ["breakfast", "lunch", "dinner", "snack"] },
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
            | UseCase::MealAdhocResolve => ProviderTier::Capable,
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
            "occasion": "lunch",
            "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
        });
        assert!(validator.is_valid(&ok), "minimal valid envelope must pass");
    }

    #[test]
    fn suggest_slot_validator_accepts_envelope_with_nutrition() {
        let validator = UseCase::MealSuggestSlot.response_validator().unwrap();
        let ok = serde_json::json!({
            "date": "2026-04-21",
            "occasion": "dinner",
            "meal_ref": { "type": "user", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
            "estimated_nutrition": { "kcal": 520.0, "protein_g": 28.0, "carbs_g": 45.0, "fat_g": 18.0 }
        });
        assert!(validator.is_valid(&ok));
    }

    #[test]
    fn suggest_slot_validator_rejects_missing_meal_ref() {
        let validator = UseCase::MealSuggestSlot.response_validator().unwrap();
        let bad = serde_json::json!({ "date": "2026-04-21", "occasion": "lunch" });
        assert!(!validator.is_valid(&bad));
    }

    #[test]
    fn suggest_slot_validator_rejects_invalid_occasion() {
        let validator = UseCase::MealSuggestSlot.response_validator().unwrap();
        let bad = serde_json::json!({
            "date": "2026-04-21",
            "occasion": "brunch",
            "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
        });
        assert!(!validator.is_valid(&bad));
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
                    "occasion": "breakfast",
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
                    "occasion": "lunch",
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
    fn meal_plan_validator_rejects_invalid_occasion() {
        let validator = UseCase::MealPlanning.response_validator().unwrap();
        let bad = serde_json::json!({
            "plan_start": "2026-04-21",
            "meals": [
                {
                    "date": "2026-04-21",
                    "occasion": "brunch",
                    "meal_ref": { "type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
                }
            ]
        });
        assert!(
            !validator.is_valid(&bad),
            "unknown occasion must be rejected"
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
                "after_milepost": "after_lunch"
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
        ] {
            assert_eq!(
                case.provider_tier(),
                ProviderTier::Capable,
                "{case:?} should use Capable tier"
            );
        }
    }
}
