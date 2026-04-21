use async_trait::async_trait;
use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::preferences;
use crate::models::UserPreferences;
use crate::repository::preferences::PreferencesRepository;

pub struct PgPreferencesRepository {
    pool: PgPool,
}

impl PgPreferencesRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PreferencesRepository for PgPreferencesRepository {
    async fn get_or_create(&self, user_id: Uuid) -> Result<UserPreferences, DatabaseError> {
        preferences::get_or_create(&self.pool, user_id).await
    }

    async fn patch_preferences(
        &self,
        user_id: Uuid,
        week_start_day: Option<i16>,
        planning_trigger_offset: Option<i16>,
        default_plan_length_days: Option<i16>,
        wake_time: Option<NaiveTime>,
    ) -> Result<UserPreferences, DatabaseError> {
        preferences::patch_preferences(
            &self.pool,
            user_id,
            week_start_day,
            planning_trigger_offset,
            default_plan_length_days,
            wake_time,
        )
        .await
    }
}
