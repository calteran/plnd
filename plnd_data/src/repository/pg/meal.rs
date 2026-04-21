use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::catalog_details::{
    get_dish, get_ingredient, get_ingredient_names_by_ids, get_meal, get_meal_nutrition,
};
use crate::db::dietary_restrictions;

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
    ) -> Result<Vec<DietaryRestriction>, crate::Error> {
        dietary_restrictions::list(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

    async fn create_dietary_restriction(
        &self,
        user_id: Uuid,
        restriction_type: &str,
        name: &str,
        notes: Option<&str>,
    ) -> Result<DietaryRestriction, crate::Error> {
        dietary_restrictions::create(&self.pool, user_id, restriction_type, name, notes)
            .await
            .map_err(Into::into)
    }

    async fn update_dietary_restriction(
        &self,
        restriction_id: Uuid,
        user_id: Uuid,
        notes: Option<&str>,
    ) -> Result<Option<DietaryRestriction>, crate::Error> {
        dietary_restrictions::update(&self.pool, restriction_id, user_id, notes)
            .await
            .map_err(Into::into)
    }

    async fn delete_dietary_restriction(
        &self,
        restriction_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, crate::Error> {
        dietary_restrictions::delete(&self.pool, restriction_id, user_id)
            .await
            .map_err(Into::into)
    }

    async fn search_catalog_meals(
        &self,
        q: &str,
        limit: i64,
        occasion: Option<&str>,
        exclude_allergens: &[String],
        user_id: Option<Uuid>,
    ) -> Result<Vec<CatalogMeal>, crate::Error> {
        db_search_catalog_meals(&self.pool, q, limit, occasion, exclude_allergens, user_id)
            .await
            .map_err(Into::into)
    }

    async fn ingredient_names_by_ids(
        &self,
        ids: &[Uuid],
    ) -> Result<Vec<(Uuid, String)>, crate::Error> {
        get_ingredient_names_by_ids(&self.pool, ids)
            .await
            .map_err(Into::into)
    }

    async fn search_ingredient_nutrition(
        &self,
        q: &str,
        limit: i64,
    ) -> Result<Vec<CatalogIngredient>, crate::Error> {
        db_search_ingredient_nutrition(&self.pool, q, limit)
            .await
            .map_err(Into::into)
    }

    async fn catalog_meal_nutrition(
        &self,
        meal_id: Uuid,
    ) -> Result<Option<Option<serde_json::Value>>, crate::Error> {
        get_meal_nutrition(&self.pool, meal_id)
            .await
            .map_err(Into::into)
    }

    async fn user_meal_nutrition(
        &self,
        meal_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<(Option<serde_json::Value>, bool)>, crate::Error> {
        user_meals::get_nutrition(&self.pool, meal_id, user_id)
            .await
            .map_err(Into::into)
    }

    async fn catalog_ingredient(
        &self,
        id: Uuid,
    ) -> Result<Option<CatalogIngredient>, crate::Error> {
        get_ingredient(&self.pool, id).await.map_err(Into::into)
    }

    async fn catalog_dish(
        &self,
        id: Uuid,
    ) -> Result<Option<(CatalogDish, Vec<CatalogDishIngredient>)>, crate::Error> {
        get_dish(&self.pool, id).await.map_err(Into::into)
    }

    async fn catalog_meal(
        &self,
        id: Uuid,
    ) -> Result<Option<(CatalogMeal, Vec<CatalogMealDish>)>, crate::Error> {
        get_meal(&self.pool, id).await.map_err(Into::into)
    }
}
