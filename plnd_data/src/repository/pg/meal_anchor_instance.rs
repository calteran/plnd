use async_trait::async_trait;
use chrono::{NaiveDate, NaiveTime};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::meal_anchor_instance as db;
use crate::models::MealAnchorInstance;
use crate::repository::meal_anchor_instance::MealAnchorInstanceRepository;

pub struct PgMealAnchorInstanceRepository {
    pool: PgPool,
}

impl PgMealAnchorInstanceRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MealAnchorInstanceRepository for PgMealAnchorInstanceRepository {
    async fn get_by_id(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<MealAnchorInstance>, crate::Error> {
        db::get_by_id(&self.pool, id, user_id)
            .await
            .map_err(Into::into)
    }

    async fn list_for_date(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<MealAnchorInstance>, crate::Error> {
        db::list_for_date(&self.pool, user_id, date)
            .await
            .map_err(Into::into)
    }

    async fn list_for_date_range(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<MealAnchorInstance>, crate::Error> {
        db::list_for_date_range(&self.pool, user_id, start, end)
            .await
            .map_err(Into::into)
    }

    async fn materialize(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<MealAnchorInstance>, crate::Error> {
        db::materialize(&self.pool, user_id, date)
            .await
            .map_err(Into::into)
    }

    async fn add(
        &self,
        user_id: Uuid,
        date: NaiveDate,
        name: &str,
        preferred_time: NaiveTime,
        tolerance_minutes: i32,
    ) -> Result<MealAnchorInstance, crate::Error> {
        db::add(
            &self.pool,
            user_id,
            date,
            name,
            preferred_time,
            tolerance_minutes,
        )
        .await
        .map_err(Into::into)
    }

    async fn rename(
        &self,
        id: Uuid,
        user_id: Uuid,
        name: &str,
    ) -> Result<Option<MealAnchorInstance>, crate::Error> {
        db::rename(&self.pool, id, user_id, name)
            .await
            .map_err(Into::into)
    }

    async fn retime(
        &self,
        id: Uuid,
        user_id: Uuid,
        preferred_time: NaiveTime,
        tolerance_minutes: i32,
    ) -> Result<Option<MealAnchorInstance>, crate::Error> {
        db::retime(&self.pool, id, user_id, preferred_time, tolerance_minutes)
            .await
            .map_err(Into::into)
    }

    async fn remove(&self, id: Uuid, user_id: Uuid) -> Result<bool, crate::Error> {
        db::remove(&self.pool, id, user_id)
            .await
            .map_err(Into::into)
    }
}
