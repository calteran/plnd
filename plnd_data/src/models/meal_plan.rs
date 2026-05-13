use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlannedMealEntry {
    pub meal_entry_id: Uuid,
    pub user_id: Uuid,
    pub schedule_entry_id: Uuid,
    pub meal_ref_id: Uuid,
    pub meal_ref_type: String, // 'user_meal' | 'catalog_meal' | 'user_dish' | 'catalog_dish'
    pub title: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct PlannedMealEntryInput {
    pub schedule_entry_id: Uuid,
    pub meal_ref_id: Uuid,
    pub meal_ref_type: String,
    pub title: Option<String>,
}

/// Staging type for meal entries carried on `CommitPlanInput`.
///
/// HTTP callers identify the target schedule entry by `(date, meal_name)`;
/// `schedule::commit_plan` resolves that pair against the schedule entries it
/// just inserted and builds the final `PlannedMealEntryInput` with the real
/// `schedule_entry_id`.
#[derive(Debug, Clone)]
pub struct PlannedMealEntryStaging {
    pub date: NaiveDate,
    pub meal_name: String,
    pub meal_ref_id: Uuid,
    pub meal_ref_type: String,
    pub title: Option<String>,
}
