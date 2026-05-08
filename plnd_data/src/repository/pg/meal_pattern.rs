use async_trait::async_trait;
use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::meal_pattern as db;
use crate::models::MealPatternEntry;
use crate::repository::meal_pattern::MealPatternRepository;

pub struct PgMealPatternRepository {
    pool: PgPool,
}

impl PgMealPatternRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MealPatternRepository for PgMealPatternRepository {
    async fn list_for_day_type(
        &self,
        day_type_id: Uuid,
    ) -> Result<Vec<MealPatternEntry>, crate::Error> {
        db::list_for_day_type(&self.pool, day_type_id)
            .await
            .map_err(Into::into)
    }

    async fn get_by_id(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<MealPatternEntry>, crate::Error> {
        db::get_by_id(&self.pool, id, user_id)
            .await
            .map_err(Into::into)
    }

    async fn create(
        &self,
        day_type_id: Uuid,
        name: &str,
        preferred_time: NaiveTime,
        tolerance_minutes: i32,
        sort_order: i32,
    ) -> Result<MealPatternEntry, crate::Error> {
        db::create(
            &self.pool,
            day_type_id,
            name,
            preferred_time,
            tolerance_minutes,
            sort_order,
        )
        .await
        .map_err(Into::into)
    }

    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        name: &str,
        preferred_time: NaiveTime,
        tolerance_minutes: i32,
        sort_order: i32,
    ) -> Result<Option<MealPatternEntry>, crate::Error> {
        db::update(
            &self.pool,
            id,
            user_id,
            name,
            preferred_time,
            tolerance_minutes,
            sort_order,
        )
        .await
        .map_err(Into::into)
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> Result<bool, crate::Error> {
        db::delete(&self.pool, id, user_id)
            .await
            .map_err(Into::into)
    }
}
