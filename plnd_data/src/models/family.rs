use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Family coordination
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Family {
    pub family_id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FamilyMember {
    pub family_member_id: Uuid,
    pub family_id: Uuid,
    pub user_id: Uuid,
    pub role: String,            // 'owner' | 'member' | 'caregiver'
    pub can_plan_for: Vec<Uuid>, // user IDs this member can schedule on behalf of
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FamilyMeal {
    pub family_meal_id: Uuid,
    pub family_id: Uuid,
    pub planned_by_user_id: Uuid,
    pub date: NaiveDate,
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    pub user_meal_id: Option<Uuid>,
    pub title: String,
    pub notes: Option<String>,
    pub participants: Vec<Uuid>, // user IDs attending
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
