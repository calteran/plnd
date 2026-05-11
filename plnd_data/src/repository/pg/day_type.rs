use async_trait::async_trait;
use chrono::{NaiveDate, NaiveTime};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::day_type as db,
    models::DayType,
    repository::day_type::{DayTypeRepository, DeleteDayTypeOutcome},
};

pub struct PgDayTypeRepository {
    pool: PgPool,
}

impl PgDayTypeRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DayTypeRepository for PgDayTypeRepository {
    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<DayType>, crate::Error> {
        db::list_for_user(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

    async fn get_by_id(&self, id: Uuid, user_id: Uuid) -> Result<Option<DayType>, crate::Error> {
        db::get_by_id(&self.pool, id, user_id)
            .await
            .map_err(Into::into)
    }

    async fn create(
        &self,
        user_id: Uuid,
        name: &str,
        days_bitmask: i32,
        wake_time: NaiveTime,
        sleep_time: NaiveTime,
        is_cycle: bool,
        cycle_length: Option<i32>,
        anchor_date: Option<NaiveDate>,
        cycle_bitmask: i32,
    ) -> Result<DayType, crate::Error> {
        db::create(
            &self.pool,
            user_id,
            name,
            days_bitmask,
            wake_time,
            sleep_time,
            is_cycle,
            cycle_length,
            anchor_date,
            cycle_bitmask,
        )
        .await
        .map_err(Into::into)
    }

    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        name: &str,
        days_bitmask: i32,
        wake_time: NaiveTime,
        sleep_time: NaiveTime,
        is_cycle: bool,
        cycle_length: Option<i32>,
        anchor_date: Option<NaiveDate>,
        cycle_bitmask: i32,
    ) -> Result<Option<DayType>, crate::Error> {
        db::update(
            &self.pool,
            id,
            user_id,
            name,
            days_bitmask,
            wake_time,
            sleep_time,
            is_cycle,
            cycle_length,
            anchor_date,
            cycle_bitmask,
        )
        .await
        .map_err(Into::into)
    }

    async fn count_for_user(&self, user_id: Uuid) -> Result<i64, crate::Error> {
        db::count_for_user(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> Result<DeleteDayTypeOutcome, crate::Error> {
        db::delete(&self.pool, id, user_id)
            .await
            .map_err(Into::into)
    }
}
