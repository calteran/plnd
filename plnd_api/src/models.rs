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
    pub occasion: String,
    pub meal_ref: MealRef,
    pub estimated_nutrition: Option<Nutrition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct SlotRef {
    pub date: NaiveDate,
    pub occasion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct MealPlanState {
    pub approved: Vec<MealEntry>,
    pub skipped: Vec<SlotRef>,
    pub custom: Vec<MealEntry>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct MealPlanRequest {
    pub week_start: NaiveDate,
    pub current_state: MealPlanState,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct NutritionSummary {
    pub avg_kcal: Option<f64>,
    pub avg_protein: Option<f64>,
    pub flags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct MealPlanResponse {
    pub week: NaiveDate,
    pub meals: Vec<MealEntry>,
    pub nutrition_summary: Option<NutritionSummary>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct MealSuggestRequest {
    pub date: NaiveDate,
    pub occasion: String,
    pub avoid_meal_refs: Option<Vec<MealRef>>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct MealAdhocResolveRequest {
    pub text: String,
    pub occasion: String,
    pub date: Option<NaiveDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct MealAdhocResolveResponse {
    pub meal_ref: MealRef,
    pub estimated_nutrition: Option<Nutrition>,
    pub confirmation: String,
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
        assert_eq!(req.week_start.to_string(), "2026-04-21");
        assert!(req.current_state.approved.is_empty());
    }

    #[test]
    fn meal_plan_request_rejects_missing_week_start() {
        let json = r#"{ "current_state": { "approved": [], "skipped": [], "custom": [] } }"#;
        let result: Result<MealPlanRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn meal_plan_response_serializes_week_as_date() {
        let resp = MealPlanResponse {
            week: chrono::NaiveDate::from_ymd_opt(2026, 4, 21).unwrap(),
            meals: vec![],
            nutrition_summary: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"week\":\"2026-04-21\""));
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
        assert_eq!(req.current_state.skipped[0].occasion, "breakfast");
    }

    #[test]
    fn meal_suggest_request_deserializes_minimal() {
        let json = r#"{"date": "2026-04-21", "occasion": "lunch"}"#;
        let req: MealSuggestRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.date.to_string(), "2026-04-21");
        assert_eq!(req.occasion, "lunch");
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
        assert_eq!(req.occasion, "dinner");
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
        assert_eq!(req.occasion, "lunch");
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
}
