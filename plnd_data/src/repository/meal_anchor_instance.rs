use async_trait::async_trait;
use chrono::{NaiveDate, NaiveTime};
use uuid::Uuid;

use crate::models::MealAnchorInstance;

#[async_trait]
pub trait MealAnchorInstanceRepository: Send + Sync {
    async fn get_by_id(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<MealAnchorInstance>, crate::Error>;

    async fn list_for_date(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<MealAnchorInstance>, crate::Error>;

    async fn list_for_date_range(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<MealAnchorInstance>, crate::Error>;

    async fn materialize(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<MealAnchorInstance>, crate::Error>;

    async fn add(
        &self,
        user_id: Uuid,
        date: NaiveDate,
        name: &str,
        preferred_time: NaiveTime,
        tolerance_minutes: i32,
    ) -> Result<MealAnchorInstance, crate::Error>;

    async fn rename(
        &self,
        id: Uuid,
        user_id: Uuid,
        name: &str,
    ) -> Result<Option<MealAnchorInstance>, crate::Error>;

    async fn retime(
        &self,
        id: Uuid,
        user_id: Uuid,
        preferred_time: NaiveTime,
        tolerance_minutes: i32,
    ) -> Result<Option<MealAnchorInstance>, crate::Error>;

    async fn remove(&self, id: Uuid, user_id: Uuid) -> Result<bool, crate::Error>;
}
