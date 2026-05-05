use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DayType {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    /// Bitmask: bit 0 = Sunday, bit 1 = Monday, …, bit 6 = Saturday.
    /// Must be 0 when `is_cycle = true` (XOR invariant).
    pub days_bitmask: i32,
    pub wake_time: NaiveTime,
    pub sleep_time: NaiveTime,
    pub is_default: bool,
    pub is_cycle: bool,
    pub cycle_length: Option<i32>,
    pub anchor_date: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
}
