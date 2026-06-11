use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MealAnchorInstance {
    pub id: Uuid,
    pub user_id: Uuid,
    pub date: NaiveDate,
    pub name: String,
    pub preferred_time: NaiveTime,
    pub tolerance_minutes: i32,
    pub sort_order: i32,
    pub template_entry_id: Option<Uuid>,
    /// Consumption lifecycle: `planned` (default), `consumed`, or `skipped`.
    /// Meals are a separate domain from tasks (architecture.md §4.6), so this
    /// is meal-specific state rather than the task status vocabulary.
    pub status: String,
    /// When the user logged the meal as eaten. Present exactly when
    /// `status == "consumed"` (enforced by a DB CHECK); `None` otherwise.
    pub consumed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// The states a meal anchor instance can occupy in its consumption lifecycle.
///
/// Kept deliberately small and meal-specific; do not reach for the task
/// status vocabulary (`in_progress`, `deferred`) which does not fit meals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MealConsumptionStatus {
    Planned,
    Consumed,
    Skipped,
}

impl MealConsumptionStatus {
    /// The wire/DB string, matching the `status` CHECK constraint vocabulary.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Consumed => "consumed",
            Self::Skipped => "skipped",
        }
    }
}
