use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::{ScheduleEntry, TimezoneAnchor};

// ---------------------------------------------------------------------------
// Weekly planning — computed query result aggregates
// These are NOT sqlx row-mapping structs; they are assembled from multiple
// query results and returned as structured API responses.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulePeriodResponse {
    pub entries: Vec<ScheduleEntry>,
    pub carryover: Vec<ScheduleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStatusResponse {
    pub planned: bool,
    pub entry_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommittedEntry {
    pub entry_id: Uuid,
    pub title: Option<String>,
    pub date: NaiveDate,
    pub after_anchor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PostSchedulePlanResponse {
    pub committed: i64,
    pub planning_task_status: String,
    pub entries: Vec<CommittedEntry>,
}

// ---------------------------------------------------------------------------
// Timezone anchors — anchor paired with its originating task title
// ---------------------------------------------------------------------------

/// A [`TimezoneAnchor`] paired with the human title of the task it was inferred
/// from, resolved via a LEFT JOIN on `source_ref` → `tasks.task_id`.
///
/// `source_title` is `None` when the anchor has no `source_ref` (e.g. device- or
/// user-sourced anchors) or when the referenced task no longer exists. The
/// anchors-list endpoint returns this so the client can render the `(why?)`
/// inferred-provenance line without a second round-trip.
#[derive(Debug, Clone)]
pub struct TimezoneAnchorWithSource {
    pub anchor: TimezoneAnchor,
    pub source_title: Option<String>,
}
