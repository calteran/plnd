use async_trait::async_trait;
use chrono::NaiveTime;
use uuid::Uuid;

use crate::models::MealPatternEntry;

#[async_trait]
pub trait MealPatternRepository: Send + Sync {
    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<MealPatternEntry>, crate::Error>;

    async fn get_by_id(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<MealPatternEntry>, crate::Error>;

    async fn create(
        &self,
        user_id: Uuid,
        name: &str,
        preferred_time: NaiveTime,
        tolerance_minutes: i32,
        sort_order: i32,
    ) -> Result<MealPatternEntry, crate::Error>;

    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        name: &str,
        preferred_time: NaiveTime,
        tolerance_minutes: i32,
        sort_order: i32,
    ) -> Result<Option<MealPatternEntry>, crate::Error>;

    async fn delete(&self, id: Uuid, user_id: Uuid) -> Result<bool, crate::Error>;
}
