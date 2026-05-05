use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Maximum number of days before the period start to search for carryover entries.
/// Older planned/deferred entries are excluded to prevent unbounded historical scans.
pub const CARRYOVER_LOOKBACK_DAYS: i64 = 90;

// ---------------------------------------------------------------------------
// Routines (recurring patterns)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Routine {
    pub routine_id: Uuid,
    pub user_id: Uuid,
    pub task_type: String,
    pub title: String,
    pub recurrence_tag: Option<String>, // 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' — nullable derived enum
    pub recurrence_rule: String,        // RRULE canonical string (e.g. 'FREQ=DAILY')
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    pub duration_minutes: Option<i32>,
    pub energy_required: String,
    pub is_anchor: bool,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>, // 'user_meal' | 'user_dish' | 'user_exercise' | ...
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Schedule entries (concrete instances on a specific date)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ScheduleEntry {
    pub entry_id: Uuid,
    pub user_id: Uuid,
    pub routine_id: Option<Uuid>, // null for ad-hoc entries
    pub task_type: Option<String>, // None = meal anchor; Some(...) = task entry
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub title: Option<String>,
    pub date: NaiveDate,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub scheduled_end: Option<DateTime<Utc>>,
    pub status: String,
    pub actual_start: Option<DateTime<Utc>>,
    pub actual_end: Option<DateTime<Utc>>,
    pub family_meal_id: Option<Uuid>,
    pub after_anchor: Option<String>, // 'breakfast' | 'lunch' | 'dinner' — temporal ordering anchor
    pub after_entry_id: Option<Uuid>, // explicit sequencing link
    pub deviation_note: Option<String>,
    pub duration_minutes: Option<i32>,
    pub energy_required: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Schedule commit input (DB-layer types, decoupled from HTTP request types)
// ---------------------------------------------------------------------------

/// DB-layer carryover decision — used by `schedule::commit_plan`.
/// The matching HTTP type (with utoipa) lives in `plnd_api/src/models.rs` and maps to this type at the route boundary.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CarryoverDecision {
    Accept,
    Defer,
    Dismiss,
}

/// Input to `schedule::commit_plan` — constructed from the HTTP request in plnd_api.
#[derive(Debug, Clone)]
pub struct CommitPlanInput {
    pub plan_start: NaiveDate,
    pub plan_end: NaiveDate,
    pub planning_task_id: Uuid,
    pub entries: Vec<PlanEntryInput>,
    /// Pre-resolved from the HTTP request's `Option<bool>` with a default of `false`.
    pub replace: bool,
    pub carryover_decisions: HashMap<Uuid, CarryoverDecision>,
}

/// One schedule entry to be committed, decoded from HTTP in plnd_api.
#[derive(Debug, Clone)]
pub struct PlanEntryInput {
    pub date: NaiveDate,
    pub task_type: Option<String>,  // None for meal anchor entries
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub title: Option<String>,
    pub scheduled_start: Option<NaiveTime>,
    pub after_anchor: Option<String>,
    pub duration_minutes: Option<i32>,
    pub energy_required: Option<String>,
}
