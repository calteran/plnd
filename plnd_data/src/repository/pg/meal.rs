use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::catalog_details::{get_ingredient_names_by_ids, get_meal_nutrition};
use crate::db::dietary_restrictions;
use crate::db::error::DatabaseError;
use crate::db::models::{
    CatalogIngredient, CatalogMeal, DietaryRestriction, UserIngredientPref, UserMealPrefDetail,
};
use crate::db::search::{
    search_catalog_meals as db_search_catalog_meals,
    search_ingredient_nutrition as db_search_ingredient_nutrition,
};
use crate::db::user_ingredient_prefs;
use crate::db::user_meal_prefs;
use crate::db::user_meals;
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

    async fn list_user_meal_prefs(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<UserMealPrefDetail>, DatabaseError> {
        user_meal_prefs::list(&self.pool, user_id).await
    }

    async fn list_user_ingredient_prefs(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<UserIngredientPref>, DatabaseError> {
        user_ingredient_prefs::list(&self.pool, user_id).await
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

    async fn create_user_meal_pref_from_description(
        &self,
        user_id: Uuid,
        name: &str,
        occasion_tags: &[String],
        nutrition: Option<serde_json::Value>,
        estimated: bool,
    ) -> Result<UserMealPrefDetail, DatabaseError> {
        user_meal_prefs::create_from_description(
            &self.pool,
            user_id,
            name,
            occasion_tags,
            nutrition,
            estimated,
        )
        .await
    }
}
