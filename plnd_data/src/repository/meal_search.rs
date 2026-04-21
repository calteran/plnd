use async_trait::async_trait;
use uuid::Uuid;

use crate::models::{LocalDishResult, LocalIngredientResult};

#[async_trait]
pub trait MealSearchRepository: Send + Sync {
    /// Browse/FTS search over `catalog_ingredients`. Distinct from
    /// `MealRepository::search_ingredient_nutrition`, which filters to rows with stored
    /// nutrition data and is consumed by the agent's estimation tool.
    async fn search_catalog_ingredients(
        &self,
        q: &str,
        limit: i64,
        exclude_allergens: &[String],
        user_id: Option<Uuid>,
    ) -> Result<Vec<LocalIngredientResult>,crate::Error>;

    async fn search_catalog_dishes(
        &self,
        q: &str,
        limit: i64,
    ) -> Result<Vec<LocalDishResult>,crate::Error>;

    async fn search_user_dishes(
        &self,
        user_id: Uuid,
        q: &str,
        limit: i64,
    ) -> Result<Vec<LocalDishResult>,crate::Error>;
}
