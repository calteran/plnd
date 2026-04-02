use plnd_data::db::models::{DietaryRestriction, User, UserPreferences};
use serde::Serialize;

/// API response wrapper for `plnd_data::db::models::User`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UserResponse {
    pub user_id: uuid::Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub is_active: bool,
    pub last_login: Option<chrono::DateTime<chrono::Utc>>,
    pub avatar_url: Option<String>,
    pub onboarding_completed: bool,
}

impl From<User> for UserResponse {
    fn from(u: User) -> Self {
        Self {
            user_id: u.user_id,
            email: u.email,
            display_name: u.display_name,
            created_at: u.created_at,
            updated_at: u.updated_at,
            is_active: u.is_active,
            last_login: u.last_login,
            avatar_url: u.avatar_url,
            onboarding_completed: u.onboarding_completed,
        }
    }
}

/// API response wrapper for `plnd_data::db::models::UserPreferences`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UserPreferencesResponse {
    pub user_id: uuid::Uuid,
    pub week_start_day: i16,
    pub planning_trigger_offset: i16,
    pub default_plan_length_days: i16,
    pub wake_time: chrono::NaiveTime,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<UserPreferences> for UserPreferencesResponse {
    fn from(p: UserPreferences) -> Self {
        Self {
            user_id: p.user_id,
            week_start_day: p.week_start_day,
            planning_trigger_offset: p.planning_trigger_offset,
            default_plan_length_days: p.default_plan_length_days,
            wake_time: p.wake_time,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}

/// API response wrapper for `plnd_data::db::models::DietaryRestriction`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DietaryRestrictionResponse {
    pub restriction_id: uuid::Uuid,
    pub user_id: uuid::Uuid,
    pub restriction_type: String,
    pub name: String,
    pub notes: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<DietaryRestriction> for DietaryRestrictionResponse {
    fn from(r: DietaryRestriction) -> Self {
        Self {
            restriction_id: r.restriction_id,
            user_id: r.user_id,
            restriction_type: r.restriction_type,
            name: r.name,
            notes: r.notes,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}
