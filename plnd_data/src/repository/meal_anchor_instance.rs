use async_trait::async_trait;
use chrono::{NaiveDate, NaiveTime};
use uuid::Uuid;

use crate::models::{MealAnchorInstance, MealConsumptionStatus};

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

    async fn materialize_range(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
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

    /// Update name and/or time fields in a single atomic write.
    /// All `None` arguments leave the corresponding column unchanged (COALESCE).
    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        name: Option<&str>,
        preferred_time: Option<NaiveTime>,
        tolerance_minutes: Option<i32>,
    ) -> Result<Option<MealAnchorInstance>, crate::Error>;

    /// Set the consumption status of an instance. Stamps `consumed_at` when
    /// transitioning to `Consumed` and clears it otherwise. Returns `None` if
    /// the instance does not exist or belongs to another user.
    async fn set_status(
        &self,
        id: Uuid,
        user_id: Uuid,
        status: MealConsumptionStatus,
    ) -> Result<Option<MealAnchorInstance>, crate::Error>;

    async fn remove(&self, id: Uuid, user_id: Uuid) -> Result<bool, crate::Error>;
}
