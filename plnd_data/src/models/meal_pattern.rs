use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MealPatternEntry {
    pub id: Uuid,
    pub day_type_id: Uuid,
    pub name: String,
    pub preferred_time: NaiveTime,
    pub tolerance_minutes: i32,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
}
