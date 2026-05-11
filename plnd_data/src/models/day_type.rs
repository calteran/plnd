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
    pub is_cycle: bool,
    pub cycle_length: Option<i32>,
    pub anchor_date: Option<NaiveDate>,
    /// For cycle types: low `cycle_length` bits indicate which positions in the
    /// cycle this day type covers, where position 0 is `anchor_date`. Must be 0
    /// when `is_cycle = false`. See `plnd_api::scheduling::day_type_applies_to`
    /// for resolution semantics.
    pub cycle_bitmask: i32,
    pub created_at: DateTime<Utc>,
}
