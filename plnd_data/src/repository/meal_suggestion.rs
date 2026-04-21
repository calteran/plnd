use async_trait::async_trait;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::meal_suggestions::MealSuggestion;

#[async_trait]
pub trait MealSuggestionRepository: Send + Sync {
    async fn get_suggestions(
        &self,
        user_id: Uuid,
        slot: &str,
        date: NaiveDate,
    ) -> Result<Vec<MealSuggestion>, DatabaseError>;
}
