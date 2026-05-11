use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// A meal slot in a user's schedule that has not yet been filled by the meal planner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenSlot {
    pub date: NaiveDate,
    pub meal_name: String,
}
