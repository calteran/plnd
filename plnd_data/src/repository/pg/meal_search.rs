use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::search::{search_dishes, search_ingredients, search_user_dishes};
use crate::models::{LocalDishResult, LocalIngredientResult};
use crate::repository::meal_search::MealSearchRepository;

pub struct PgMealSearchRepository {
    pool: PgPool,
}

impl PgMealSearchRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MealSearchRepository for PgMealSearchRepository {
    async fn search_catalog_ingredients(
        &self,
        q: &str,
        limit: i64,
        exclude_allergens: &[String],
        user_id: Option<Uuid>,
    ) -> Result<Vec<LocalIngredientResult>, DatabaseError> {
        search_ingredients(&self.pool, q, limit, exclude_allergens, user_id).await
    }

    async fn search_catalog_dishes(
        &self,
        q: &str,
        limit: i64,
    ) -> Result<Vec<LocalDishResult>, DatabaseError> {
        search_dishes(&self.pool, q, limit).await
    }

    async fn search_user_dishes(
        &self,
        user_id: Uuid,
        q: &str,
        limit: i64,
    ) -> Result<Vec<LocalDishResult>, DatabaseError> {
        search_user_dishes(&self.pool, user_id, q, limit).await
    }
}
