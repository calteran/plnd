use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::meal_suggestions;
use crate::models::MealSuggestion;
use crate::repository::meal_suggestion::MealSuggestionRepository;

pub struct PgMealSuggestionRepository {
    pool: PgPool,
}

impl PgMealSuggestionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MealSuggestionRepository for PgMealSuggestionRepository {
    async fn get_suggestions(
        &self,
        user_id: Uuid,
        slot: &str,
        date: NaiveDate,
    ) -> Result<Vec<MealSuggestion>, crate::Error> {
        meal_suggestions::get_suggestions(&self.pool, user_id, slot, &date.to_string())
            .await
            .map_err(Into::into)
    }
}
