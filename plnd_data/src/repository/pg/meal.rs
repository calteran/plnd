use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::catalog_details::{
    get_dish, get_ingredient, get_ingredient_names_by_ids, get_meal, get_meal_nutrition,
};
use crate::db::dietary_restrictions;
use crate::db::error::DatabaseError;
use crate::db::search::{
    search_catalog_meals as db_search_catalog_meals,
    search_ingredient_nutrition as db_search_ingredient_nutrition,
};
use crate::db::user_meals;
use crate::models::{
    CatalogDish, CatalogDishIngredient, CatalogIngredient, CatalogMeal, CatalogMealDish,
    DietaryRestriction,
};
use crate::repository::meal::MealRepository;

pub struct PgMealRepository {
    pool: PgPool,
}

impl PgMealRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MealRepository for PgMealRepository {
    async fn list_dietary_restrictions(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<DietaryRestriction>, DatabaseError> {
        dietary_restrictions::list(&self.pool, user_id).await
    }

    async fn create_dietary_restriction(
        &self,
        user_id: Uuid,
        restriction_type: &str,
        name: &str,
        notes: Option<&str>,
    ) -> Result<DietaryRestriction, DatabaseError> {
        dietary_restrictions::create(&self.pool, user_id, restriction_type, name, notes).await
    }

    async fn update_dietary_restriction(
        &self,
        restriction_id: Uuid,
        user_id: Uuid,
        notes: Option<&str>,
    ) -> Result<Option<DietaryRestriction>, DatabaseError> {
        dietary_restrictions::update(&self.pool, restriction_id, user_id, notes).await
    }

    async fn delete_dietary_restriction(
        &self,
        restriction_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, DatabaseError> {
        dietary_restrictions::delete(&self.pool, restriction_id, user_id).await
    }

    async fn search_catalog_meals(
        &self,
        q: &str,
        limit: i64,
        occasion: Option<&str>,
        exclude_allergens: &[String],
        user_id: Option<Uuid>,
    ) -> Result<Vec<CatalogMeal>, DatabaseError> {
        db_search_catalog_meals(&self.pool, q, limit, occasion, exclude_allergens, user_id).await
    }

    async fn ingredient_names_by_ids(
        &self,
        ids: &[Uuid],
    ) -> Result<Vec<(Uuid, String)>, DatabaseError> {
        get_ingredient_names_by_ids(&self.pool, ids).await
    }

    async fn search_ingredient_nutrition(
        &self,
        q: &str,
        limit: i64,
    ) -> Result<Vec<CatalogIngredient>, DatabaseError> {
        db_search_ingredient_nutrition(&self.pool, q, limit).await
    }

    async fn catalog_meal_nutrition(
        &self,
        meal_id: Uuid,
    ) -> Result<Option<Option<serde_json::Value>>, DatabaseError> {
        get_meal_nutrition(&self.pool, meal_id).await
    }

    async fn user_meal_nutrition(
        &self,
        meal_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<(Option<serde_json::Value>, bool)>, DatabaseError> {
        user_meals::get_nutrition(&self.pool, meal_id, user_id).await
    }

    async fn catalog_ingredient(
        &self,
        id: Uuid,
    ) -> Result<Option<CatalogIngredient>, DatabaseError> {
        get_ingredient(&self.pool, id).await
    }

    async fn catalog_dish(
        &self,
        id: Uuid,
    ) -> Result<Option<(CatalogDish, Vec<CatalogDishIngredient>)>, DatabaseError> {
        get_dish(&self.pool, id).await
    }

    async fn catalog_meal(
        &self,
        id: Uuid,
    ) -> Result<Option<(CatalogMeal, Vec<CatalogMealDish>)>, DatabaseError> {
        get_meal(&self.pool, id).await
    }
}
