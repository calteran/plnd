use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::user_meal_prefs;
use crate::models::UserMealPrefDetail;
use crate::repository::user_meal_pref::{AddDishParams, UserMealPrefRepository};

pub struct PgUserMealPrefRepository {
    pool: PgPool,
}

impl PgUserMealPrefRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UserMealPrefRepository for PgUserMealPrefRepository {
    async fn list(&self, user_id: Uuid) -> Result<Vec<UserMealPrefDetail>, crate::Error> {
        user_meal_prefs::list(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

    async fn get(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
    ) -> Result<Option<UserMealPrefDetail>, crate::Error> {
        user_meal_prefs::get(&self.pool, user_id, pref_id)
            .await
            .map_err(Into::into)
    }

    async fn create_from_catalog(
        &self,
        user_id: Uuid,
        catalog_meal_id: Uuid,
    ) -> Result<UserMealPrefDetail, crate::Error> {
        user_meal_prefs::create_from_catalog(&self.pool, user_id, catalog_meal_id)
            .await
            .map_err(Into::into)
    }

    async fn create_from_scratch(
        &self,
        user_id: Uuid,
        name: &str,
        description: Option<&str>,
    ) -> Result<UserMealPrefDetail, crate::Error> {
        user_meal_prefs::create_from_scratch(&self.pool, user_id, name, description)
            .await
            .map_err(Into::into)
    }

    async fn create_from_description(
        &self,
        user_id: Uuid,
        name: &str,
        occasion_tags: &[String],
        nutrition: Option<serde_json::Value>,
        estimated: bool,
    ) -> Result<UserMealPrefDetail, crate::Error> {
        user_meal_prefs::create_from_description(
            &self.pool,
            user_id,
            name,
            occasion_tags,
            nutrition,
            estimated,
        )
        .await
        .map_err(Into::into)
    }

    async fn update_metadata(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        rating: Option<Option<i16>>,
        is_safe_food: Option<bool>,
        is_blocked: Option<bool>,
        notes: Option<Option<String>>,
    ) -> Result<Option<UserMealPrefDetail>, crate::Error> {
        user_meal_prefs::update_metadata(
            &self.pool,
            user_id,
            pref_id,
            rating,
            is_safe_food,
            is_blocked,
            notes,
        )
        .await
        .map_err(Into::into)
    }

    async fn fork_and_update_recipe(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Option<UserMealPrefDetail>, crate::Error> {
        user_meal_prefs::fork_and_update_recipe(&self.pool, user_id, pref_id, name, description)
            .await
            .map_err(Into::into)
    }

    async fn delete(&self, user_id: Uuid, pref_id: Uuid) -> Result<bool, crate::Error> {
        user_meal_prefs::delete(&self.pool, user_id, pref_id)
            .await
            .map_err(Into::into)
    }

    async fn add_dish(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        params: AddDishParams,
    ) -> Result<Option<UserMealPrefDetail>, crate::Error> {
        user_meal_prefs::add_dish(&self.pool, user_id, pref_id, params)
            .await
            .map_err(Into::into)
    }

    async fn remove_dish(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        meal_dish_id: Uuid,
    ) -> Result<Option<bool>, crate::Error> {
        user_meal_prefs::remove_dish(&self.pool, user_id, pref_id, meal_dish_id)
            .await
            .map_err(Into::into)
    }
}
