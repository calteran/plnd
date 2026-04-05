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

fn deserialize_hhmm<'de, D>(deserializer: D) -> Result<NaiveTime, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    NaiveTime::parse_from_str(&s, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(&s, "%H:%M:%S"))
        .map_err(serde::de::Error::custom)
}

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
    /// UTC wall-clock time as "HH:MM" or "HH:MM:SS"
    #[serde(deserialize_with = "deserialize_hhmm")]
    pub scheduled_start: NaiveTime,
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
    pub context: Option<Vec<ConversationTurn>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct TaskEntryResponse {
    pub actions_taken: Vec<ActionTaken>,
    pub ui_signals: Vec<serde_json::Value>,
    pub confirmation: String,
}
