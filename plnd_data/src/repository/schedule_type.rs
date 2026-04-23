use async_trait::async_trait;
use chrono::{NaiveDate, NaiveTime};
use uuid::Uuid;

use crate::models::ScheduleType;

#[async_trait]
pub trait ScheduleTypeRepository: Send + Sync {
    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<ScheduleType>, crate::Error>;

    async fn get_by_id(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<ScheduleType>, crate::Error>;

    #[allow(clippy::too_many_arguments)]
    async fn create(
        &self,
        user_id: Uuid,
        name: &str,
        days_bitmask: i32,
        wake_time: NaiveTime,
        bed_time: NaiveTime,
        is_cycle: bool,
        cycle_length: Option<i32>,
        anchor_date: Option<NaiveDate>,
    ) -> Result<ScheduleType, crate::Error>;

    #[allow(clippy::too_many_arguments)]
    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        name: &str,
        days_bitmask: i32,
        wake_time: NaiveTime,
        bed_time: NaiveTime,
        is_cycle: bool,
        cycle_length: Option<i32>,
        anchor_date: Option<NaiveDate>,
    ) -> Result<Option<ScheduleType>, crate::Error>;

    async fn count_for_user(&self, user_id: Uuid) -> Result<i64, crate::Error>;

    async fn delete(&self, id: Uuid, user_id: Uuid) -> Result<bool, crate::Error>;
}
