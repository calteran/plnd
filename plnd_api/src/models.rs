use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

#[derive(Serialize, utoipa::ToSchema)]
pub struct ReadyStatus {
    pub status: String,
    pub database: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

fn deserialize_opt_hhmm<'de, D>(deserializer: D) -> Result<Option<NaiveTime>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: Option<String> = Option::deserialize(deserializer)?;
    match s {
        None => Ok(None),
        Some(s) => NaiveTime::parse_from_str(&s, "%H:%M")
            .or_else(|_| NaiveTime::parse_from_str(&s, "%H:%M:%S"))
            .map(Some)
            .map_err(serde::de::Error::custom),
    }
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PatchPreferencesRequest {
    pub week_start_day: Option<i16>,
    pub planning_trigger_offset: Option<i16>,
    pub default_plan_length_days: Option<i16>,
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub wake_time: Option<NaiveTime>,
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub breakfast_window_start: Option<NaiveTime>,
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub breakfast_window_end: Option<NaiveTime>,
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub lunch_window_start: Option<NaiveTime>,
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub lunch_window_end: Option<NaiveTime>,
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub dinner_window_start: Option<NaiveTime>,
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub dinner_window_end: Option<NaiveTime>,
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub planning_time: Option<NaiveTime>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateMealHabitRequest {
    pub meal_name: String,
    pub slot: String,
    pub recurrence_rule: String,
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PlanEntryRequest {
    pub date: NaiveDate,
    pub task_type: String,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub title: Option<String>,
    /// UTC wall-clock time as "HH:MM" or "HH:MM:SS"; omit for bucket tasks (after_milepost)
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub scheduled_start: Option<NaiveTime>,
    pub after_milepost: Option<String>,
    pub duration_minutes: Option<u32>,
    pub energy_required: Option<String>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum CarryoverDecision {
    Accept,
    Defer,
    Dismiss,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PatchEntryStatusRequest {
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PostSchedulePlanRequest {
    pub plan_start: NaiveDate,
    pub plan_end: NaiveDate,
    pub planning_task_id: Uuid,
    pub entries: Vec<PlanEntryRequest>,
    pub replace: Option<bool>,
    #[serde(default)]
    pub carryover_decisions: HashMap<Uuid, CarryoverDecision>,
    /// AI-placed one-off tasks from the Task Placement Review step.
    #[serde(default)]
    pub placed_tasks: Vec<PlanEntryRequest>,
    /// Meal habit IDs to expand into recurring meal entries across plan_start–plan_end.
    #[serde(default)]
    pub meal_habit_ids: Vec<Uuid>,
    /// Schedule template IDs to expand into recurring task entries across plan_start–plan_end.
    #[serde(default)]
    pub schedule_template_ids: Vec<Uuid>,
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ActionTaken {
    pub r#type: String,
    pub task_id: Option<Uuid>,
    pub date: Option<NaiveDate>,
    pub after_milepost: Option<String>,
    pub scheduled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ConversationTurn {
    pub signals: Vec<serde_json::Value>,
    pub answers: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct TaskEntryRequest {
    pub input: String,
    pub date: Option<NaiveDate>,
    pub context: Option<Vec<ConversationTurn>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct TaskEntryResponse {
    pub actions_taken: Vec<ActionTaken>,
    pub ui_signals: Vec<serde_json::Value>,
    pub confirmation: String,
}

// ---------------------------------------------------------------------------
// Agent — Occasion
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Occasion {
    Breakfast,
    Lunch,
    Dinner,
    Snack,
}

impl std::fmt::Display for Occasion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Occasion::Breakfast => "breakfast",
            Occasion::Lunch => "lunch",
            Occasion::Dinner => "dinner",
            Occasion::Snack => "snack",
        })
    }
}

// ---------------------------------------------------------------------------
// Agent — Meal Planning
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct MealRef {
    #[serde(rename = "type")]
    pub meal_type: String,
    pub id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct Nutrition {
    pub kcal: f64,
    pub protein_g: f64,
    pub carbs_g: f64,
    pub fat_g: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct MealEntry {
    pub date: NaiveDate,
    pub occasion: Occasion,
    pub meal_ref: MealRef,
    pub estimated_nutrition: Option<Nutrition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct SlotRef {
    pub date: NaiveDate,
    pub occasion: Occasion,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct MealPlanState {
    pub approved: Vec<MealEntry>,
    pub skipped: Vec<SlotRef>,
    pub custom: Vec<MealEntry>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct MealPlanRequest {
    /// First day (inclusive) of the planning period.
    /// Accepts `week_start` as a backward-compatible alias; when only the alias is
    /// supplied, `plan_end` defaults to `plan_start + 6` (7-day week).
    #[serde(alias = "week_start")]
    pub plan_start: NaiveDate,
    /// Last day (inclusive) of the planning period.
    /// Omit to keep weekly behaviour (`plan_start + 6`).
    pub plan_end: Option<NaiveDate>,
    pub current_state: MealPlanState,
}

impl MealPlanRequest {
    /// Effective last day: explicit `plan_end` if provided, else `plan_start + 6` (7-day week).
    pub fn plan_end_effective(&self) -> NaiveDate {
        self.plan_end
            .unwrap_or(self.plan_start + chrono::Days::new(6))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct NutritionSummary {
    pub avg_kcal: Option<f64>,
    pub avg_protein: Option<f64>,
    pub flags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct MealPlanResponse {
    pub plan_start: NaiveDate,
    pub meals: Vec<MealEntry>,
    pub nutrition_summary: Option<NutritionSummary>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct MealSuggestRequest {
    pub date: NaiveDate,
    pub occasion: Occasion,
    pub avoid_meal_refs: Option<Vec<MealRef>>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct MealAdhocResolveRequest {
    pub text: String,
    pub occasion: Occasion,
    pub date: Option<NaiveDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct MealAdhocResolveResponse {
    pub meal_ref: MealRef,
    pub estimated_nutrition: Option<Nutrition>,
    pub confirmation: String,
}

// ---------------------------------------------------------------------------
// Agent — Task Placement
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct RoutineTemplateInput {
    pub title: String,
    pub task_type: String,
    /// RRULE string: "FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,WE", "FREQ=MONTHLY;BYMONTHDAY=15", etc.
    pub recurrence_rule: String,
    pub duration_minutes: u32,
    pub energy_required: String,
    /// Preferred window start as "HH:MM"; rejected at deserialization if not a valid time.
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub time_window_start: Option<NaiveTime>,
    /// Preferred window end as "HH:MM"; rejected at deserialization if not a valid time.
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub time_window_end: Option<NaiveTime>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PlaceTasksRequest {
    pub task_names: Vec<String>,
    pub plan_start: NaiveDate,
    pub plan_end: NaiveDate,
    #[serde(default)]
    pub routine_templates: Vec<RoutineTemplateInput>,
}

/// One scheduled task entry returned by `POST /agent/place-tasks`.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct PlaceTasksEntry {
    pub title: String,
    pub scheduled_date: NaiveDate,
    pub task_type: String,
    pub duration_minutes: u32,
    pub energy_required: String,
    /// Meal anchor for floating tasks — mutually exclusive with `time_window_start`.
    pub after_milepost: Option<String>,
    /// Wall-clock start time "HH:MM" for fixed tasks — mutually exclusive with `after_milepost`.
    pub time_window_start: Option<String>,
}

#[cfg(test)]
mod place_tasks_tests {
    use super::*;

    #[test]
    fn plan_entry_request_accepts_optional_duration_and_energy() {
        let json = r#"{
            "date": "2026-04-22",
            "task_type": "floating",
            "duration_minutes": 30,
            "energy_required": "low"
        }"#;
        let req: PlanEntryRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.duration_minutes, Some(30));
        assert_eq!(req.energy_required.as_deref(), Some("low"));
    }

    #[test]
    fn plan_entry_request_duration_and_energy_default_to_none() {
        let json = r#"{"date": "2026-04-22", "task_type": "floating"}"#;
        let req: PlanEntryRequest = serde_json::from_str(json).unwrap();
        assert!(req.duration_minutes.is_none());
        assert!(req.energy_required.is_none());
    }

    #[test]
    fn place_tasks_request_deserializes() {
        let json = r#"{
            "task_names": ["Call dentist", "Finish report"],
            "plan_start": "2026-04-22",
            "plan_end": "2026-05-05"
        }"#;
        let req: PlaceTasksRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.task_names.len(), 2);
        assert_eq!(req.task_names[0], "Call dentist");
    }

    #[test]
    fn place_tasks_request_rejects_missing_task_names() {
        let json = r#"{"plan_start": "2026-04-22", "plan_end": "2026-05-05"}"#;
        let result: Result<PlaceTasksRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn place_tasks_entry_deserializes_floating() {
        let json = r#"{
            "title": "Call dentist",
            "scheduled_date": "2026-04-23",
            "after_milepost": "lunch",
            "duration_minutes": 30,
            "energy_required": "low",
            "task_type": "appointment"
        }"#;
        let entry: PlaceTasksEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.title, "Call dentist");
        assert_eq!(entry.duration_minutes, 30);
        assert_eq!(entry.energy_required, "low");
        assert_eq!(entry.after_milepost.as_deref(), Some("lunch"));
        assert!(entry.time_window_start.is_none());
    }

    #[test]
    fn place_tasks_entry_deserializes_fixed() {
        let json = r#"{
            "title": "Doctor appointment",
            "scheduled_date": "2026-04-23",
            "time_window_start": "10:00",
            "duration_minutes": 60,
            "energy_required": "medium",
            "task_type": "appointment"
        }"#;
        let entry: PlaceTasksEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.time_window_start.as_deref(), Some("10:00"));
        assert!(entry.after_milepost.is_none());
    }

    #[test]
    fn place_tasks_entry_serializes_date_as_iso() {
        let entry = PlaceTasksEntry {
            title: "Call dentist".to_string(),
            scheduled_date: chrono::NaiveDate::from_ymd_opt(2026, 4, 23).unwrap(),
            task_type: "appointment".to_string(),
            duration_minutes: 30,
            energy_required: "low".to_string(),
            after_milepost: Some("lunch".to_string()),
            time_window_start: None,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"scheduled_date\":\"2026-04-23\""));
    }

    #[test]
    fn routine_template_input_deserializes_fully() {
        let json = r#"{
            "title": "Medication",
            "task_type": "medication",
            "recurrence_rule": "FREQ=DAILY",
            "duration_minutes": 15,
            "energy_required": "low",
            "time_window_start": "08:00",
            "time_window_end": "08:30"
        }"#;
        let t: RoutineTemplateInput = serde_json::from_str(json).unwrap();
        assert_eq!(t.title, "Medication");
        assert_eq!(t.recurrence_rule, "FREQ=DAILY");
        assert_eq!(
            t.time_window_start,
            Some(chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap())
        );
    }

    #[test]
    fn routine_template_input_rejects_invalid_time_window() {
        for bad in &["25:99", "not-a-time", "24:00"] {
            let json = format!(
                r#"{{
                    "title": "Medication",
                    "task_type": "medication",
                    "recurrence_rule": "FREQ=DAILY",
                    "duration_minutes": 15,
                    "energy_required": "low",
                    "time_window_start": "{bad}"
                }}"#
            );
            let result: Result<RoutineTemplateInput, _> = serde_json::from_str(&json);
            assert!(
                result.is_err(),
                "expected deserialization to fail for time_window_start={bad}"
            );
        }
    }

    #[test]
    fn place_tasks_request_backward_compatible_without_templates() {
        let json = r#"{
            "task_names": ["Buy groceries"],
            "plan_start": "2026-04-28",
            "plan_end": "2026-05-04"
        }"#;
        let req: PlaceTasksRequest = serde_json::from_str(json).unwrap();
        assert!(req.routine_templates.is_empty());
    }
}

#[cfg(test)]
mod meal_plan_tests {
    use super::*;

    #[test]
    fn meal_plan_request_deserializes_minimal() {
        let json = r#"{
            "week_start": "2026-04-21",
            "current_state": { "approved": [], "skipped": [], "custom": [] }
        }"#;
        let req: MealPlanRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.plan_start.to_string(), "2026-04-21");
        assert!(req.current_state.approved.is_empty());
    }

    #[test]
    fn meal_plan_request_rejects_missing_plan_start() {
        let json = r#"{ "current_state": { "approved": [], "skipped": [], "custom": [] } }"#;
        let result: Result<MealPlanRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn meal_plan_response_serializes_plan_start_as_date() {
        let resp = MealPlanResponse {
            plan_start: chrono::NaiveDate::from_ymd_opt(2026, 4, 21).unwrap(),
            meals: vec![],
            nutrition_summary: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"plan_start\":\"2026-04-21\""));
    }

    #[test]
    fn meal_plan_request_state_has_skipped_slots() {
        let json = r#"{
            "week_start": "2026-04-21",
            "current_state": {
                "approved": [],
                "skipped": [{"date": "2026-04-21", "occasion": "breakfast"}],
                "custom": []
            }
        }"#;
        let req: MealPlanRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.current_state.skipped.len(), 1);
        assert_eq!(req.current_state.skipped[0].occasion, Occasion::Breakfast);
    }

    #[test]
    fn meal_suggest_request_deserializes_minimal() {
        let json = r#"{"date": "2026-04-21", "occasion": "lunch"}"#;
        let req: MealSuggestRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.date.to_string(), "2026-04-21");
        assert_eq!(req.occasion, Occasion::Lunch);
        assert!(req.avoid_meal_refs.is_none());
    }

    #[test]
    fn meal_suggest_request_deserializes_with_avoid_refs() {
        let json = r#"{
            "date": "2026-04-21",
            "occasion": "dinner",
            "avoid_meal_refs": [
                {"type": "catalog", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}
            ]
        }"#;
        let req: MealSuggestRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.occasion, Occasion::Dinner);
        let refs = req.avoid_meal_refs.unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].meal_type, "catalog");
    }

    #[test]
    fn meal_suggest_request_rejects_missing_date() {
        let json = r#"{"occasion": "lunch"}"#;
        let result: Result<MealSuggestRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn meal_adhoc_resolve_request_deserializes() {
        let json = r#"{"text": "grilled cheese sandwich", "occasion": "lunch"}"#;
        let req: MealAdhocResolveRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.text, "grilled cheese sandwich");
        assert_eq!(req.occasion, Occasion::Lunch);
        assert!(req.date.is_none());
    }

    #[test]
    fn meal_adhoc_resolve_request_with_date_deserializes() {
        let json = r#"{"text": "oatmeal", "occasion": "breakfast", "date": "2026-04-21"}"#;
        let req: MealAdhocResolveRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            req.date,
            Some(chrono::NaiveDate::from_ymd_opt(2026, 4, 21).unwrap())
        );
    }

    #[test]
    fn meal_adhoc_resolve_request_rejects_missing_text() {
        let json = r#"{"occasion": "lunch"}"#;
        let result: Result<MealAdhocResolveRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn meal_adhoc_resolve_response_serializes() {
        let resp = MealAdhocResolveResponse {
            meal_ref: MealRef {
                meal_type: "catalog".to_string(),
                id: uuid::Uuid::new_v4(),
            },
            estimated_nutrition: None,
            confirmation: "Found it.".to_string(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"type\":\"catalog\""));
        assert!(json.contains("\"confirmation\":\"Found it.\""));
    }

    #[test]
    fn occasion_rejects_invalid_value() {
        let result: Result<MealSuggestRequest, _> =
            serde_json::from_str(r#"{"date": "2026-04-21", "occasion": "brunch"}"#);
        assert!(
            result.is_err(),
            "brunch must be rejected at deserialization"
        );
    }

    #[test]
    fn occasion_accepts_all_valid_values() {
        for (json, expected) in [
            ("breakfast", Occasion::Breakfast),
            ("lunch", Occasion::Lunch),
            ("dinner", Occasion::Dinner),
            ("snack", Occasion::Snack),
        ] {
            let req: MealSuggestRequest = serde_json::from_str(&format!(
                r#"{{"date": "2026-04-21", "occasion": "{}"}}"#,
                json
            ))
            .unwrap_or_else(|_| panic!("{json} should deserialize"));
            assert_eq!(req.occasion, expected);
        }
    }

    #[test]
    fn occasion_serializes_to_lowercase() {
        for (variant, expected) in [
            (Occasion::Breakfast, "breakfast"),
            (Occasion::Lunch, "lunch"),
            (Occasion::Dinner, "dinner"),
            (Occasion::Snack, "snack"),
        ] {
            assert_eq!(variant.to_string(), expected);
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, format!("\"{}\"", expected));
        }
    }
}
