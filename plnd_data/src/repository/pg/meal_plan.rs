use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::meal_plan as db;
use crate::models::{PlannedMealEntry, PlannedMealEntryInput};
use crate::repository::meal_plan::MealPlanRepository;

pub struct PgMealPlanRepository {
    pool: PgPool,
}

impl PgMealPlanRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MealPlanRepository for PgMealPlanRepository {
    async fn list_for_date(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<PlannedMealEntry>, crate::Error> {
        db::list_for_date(&self.pool, user_id, date)
            .await
            .map_err(Into::into)
    }

    async fn list_for_period(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<PlannedMealEntry>, crate::Error> {
        db::list_for_period(&self.pool, user_id, start, end)
            .await
            .map_err(Into::into)
    }

    async fn insert_many(
        &self,
        user_id: Uuid,
        entries: &[PlannedMealEntryInput],
    ) -> Result<Vec<PlannedMealEntry>, crate::Error> {
        db::insert_many(&self.pool, user_id, entries)
            .await
            .map_err(Into::into)
    }

    async fn delete_for_period(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<u64, crate::Error> {
        db::delete_for_period(&self.pool, user_id, start, end)
            .await
            .map_err(Into::into)
    }
}
