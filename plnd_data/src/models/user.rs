use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserPreferences {
    pub user_id: Uuid,
    pub week_start_day: i16,
    pub planning_trigger_offset: i16,
    pub default_plan_length_days: i16,
    pub wake_time: NaiveTime,
    pub breakfast_window_start: Option<NaiveTime>,
    pub breakfast_window_end: Option<NaiveTime>,
    pub lunch_window_start: Option<NaiveTime>,
    pub lunch_window_end: Option<NaiveTime>,
    pub dinner_window_start: Option<NaiveTime>,
    pub dinner_window_end: Option<NaiveTime>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MealHabit {
    pub id: Uuid,
    pub user_id: Uuid,
    pub meal_name: String,
    pub slot: String,
    pub recurrence_rule: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DietaryRestriction {
    pub restriction_id: Uuid,
    pub user_id: Uuid,
    pub restriction_type: String,
    pub name: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserMemory {
    pub memory_id: Uuid,
    pub user_id: Uuid,
    pub category: String,
    pub content: String,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub is_active: bool,
    pub last_login: Option<DateTime<Utc>>,
    pub avatar_url: Option<String>,
    pub onboarding_completed: bool,
}
