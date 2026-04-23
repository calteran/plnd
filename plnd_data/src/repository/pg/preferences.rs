use async_trait::async_trait;
use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

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
    async fn get_or_create(&self, user_id: Uuid) -> Result<UserPreferences, crate::Error> {
        preferences::get_or_create(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

    async fn patch_preferences(
        &self,
        user_id: Uuid,
        week_start_day: Option<i16>,
        planning_trigger_offset: Option<i16>,
        default_plan_length_days: Option<i16>,
        wake_time: Option<NaiveTime>,
    ) -> Result<UserPreferences, crate::Error> {
        preferences::patch_preferences(
            &self.pool,
            user_id,
            week_start_day,
            planning_trigger_offset,
            default_plan_length_days,
            wake_time,
        )
        .await
        .map_err(Into::into)
    }

    async fn update_meal_windows(
        &self,
        user_id: Uuid,
        breakfast_window_start: Option<NaiveTime>,
        breakfast_window_end: Option<NaiveTime>,
        lunch_window_start: Option<NaiveTime>,
        lunch_window_end: Option<NaiveTime>,
        dinner_window_start: Option<NaiveTime>,
        dinner_window_end: Option<NaiveTime>,
    ) -> Result<UserPreferences, crate::Error> {
        preferences::update_meal_windows(
            &self.pool,
            user_id,
            breakfast_window_start,
            breakfast_window_end,
            lunch_window_start,
            lunch_window_end,
            dinner_window_start,
            dinner_window_end,
        )
        .await
        .map_err(Into::into)
    }
}
