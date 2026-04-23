use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::meal_habits;
use crate::models::MealHabit;
use crate::repository::meal_habit::MealHabitRepository;

pub struct PgMealHabitRepository {
    pool: PgPool,
}

impl PgMealHabitRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MealHabitRepository for PgMealHabitRepository {
    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<MealHabit>, crate::Error> {
        meal_habits::list(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

    async fn create(
        &self,
        user_id: Uuid,
        meal_name: &str,
        slot: &str,
        recurrence_rule: &str,
    ) -> Result<MealHabit, crate::Error> {
        meal_habits::create(&self.pool, user_id, meal_name, slot, recurrence_rule)
            .await
            .map_err(Into::into)
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> Result<bool, crate::Error> {
        meal_habits::delete(&self.pool, id, user_id)
            .await
            .map_err(Into::into)
    }
}
