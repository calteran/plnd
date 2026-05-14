use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use veil::Redact;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserPreferences {
    pub user_id: Uuid,
    pub week_start_day: i16,
    pub planning_trigger_offset: i16,
    pub default_plan_length_days: i16,
    pub planning_time: Option<NaiveTime>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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

#[derive(Redact, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[redact(all)]
pub struct User {
    #[redact(skip)]
    pub user_id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    #[redact(skip)]
    pub created_at: DateTime<Utc>,
    #[redact(skip)]
    pub updated_at: DateTime<Utc>,
    #[redact(skip)]
    pub is_active: bool,
    #[redact(skip)]
    pub last_login: Option<DateTime<Utc>>,
    pub avatar_url: Option<String>,
    #[redact(skip)]
    pub onboarding_completed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_debug_redacts_pii() {
        let user = User {
            user_id: Uuid::nil(),
            email: "secret@example.com".to_string(),
            display_name: Some("Jane Doe".to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            is_active: true,
            last_login: None,
            avatar_url: Some("https://example.com/photo.jpg".to_string()),
            onboarding_completed: false,
        };
        let debug = format!("{:?}", user);

        assert!(
            !debug.contains("secret@example.com"),
            "email leaked: {debug}"
        );
        assert!(!debug.contains("Jane Doe"), "display_name leaked: {debug}");
        assert!(!debug.contains("photo.jpg"), "avatar_url leaked: {debug}");

        assert!(
            debug.contains("00000000-0000-0000-0000-000000000000"),
            "user_id missing: {debug}"
        );
    }
}
