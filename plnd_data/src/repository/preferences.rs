use async_trait::async_trait;
use chrono::NaiveTime;
use uuid::Uuid;

use crate::models::UserPreferences;

#[async_trait]
pub trait PreferencesRepository: Send + Sync {
    async fn get_or_create(&self, user_id: Uuid) -> Result<UserPreferences, crate::Error>;

    async fn patch_preferences(
        &self,
        user_id: Uuid,
        week_start_day: Option<i16>,
        planning_trigger_offset: Option<i16>,
        default_plan_length_days: Option<i16>,
        planning_time: Option<NaiveTime>,
    ) -> Result<UserPreferences, crate::Error>;
}
