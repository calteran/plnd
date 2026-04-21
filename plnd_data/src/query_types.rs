use serde::{Deserialize, Serialize};

use crate::models::ScheduleEntry;

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

#[derive(Debug, Clone, Serialize)]
pub struct PostSchedulePlanResponse {
    pub committed: i64,
    pub planning_task_status: String,
}
