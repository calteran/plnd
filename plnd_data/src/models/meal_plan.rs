use chrono::{DateTime, Utc};
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
