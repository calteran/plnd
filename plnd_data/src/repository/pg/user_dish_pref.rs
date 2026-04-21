use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::user_dish_prefs as db;
use crate::models::UserDishPrefDetail;
use crate::repository::user_dish_pref::{AddIngredientParams, UserDishPrefRepository};

pub struct PgUserDishPrefRepository {
    pool: PgPool,
}

impl PgUserDishPrefRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UserDishPrefRepository for PgUserDishPrefRepository {
    async fn list(&self, user_id: Uuid) -> Result<Vec<UserDishPrefDetail>, crate::Error> {
        db::list(&self.pool, user_id).await.map_err(Into::into)
    }

    async fn get(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
    ) -> Result<Option<UserDishPrefDetail>, crate::Error> {
        db::get(&self.pool, user_id, pref_id)
            .await
            .map_err(Into::into)
    }

    async fn create_from_catalog(
        &self,
        user_id: Uuid,
        catalog_dish_id: Uuid,
    ) -> Result<UserDishPrefDetail, crate::Error> {
        db::create_from_catalog(&self.pool, user_id, catalog_dish_id)
            .await
            .map_err(Into::into)
    }

    async fn create_from_scratch(
        &self,
        user_id: Uuid,
        name: &str,
        instructions: Option<&str>,
        prep_time_minutes: Option<i32>,
        cook_time_minutes: Option<i32>,
    ) -> Result<UserDishPrefDetail, crate::Error> {
        db::create_from_scratch(
            &self.pool,
            user_id,
            name,
            instructions,
            prep_time_minutes,
            cook_time_minutes,
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
    ) -> Result<Option<UserDishPrefDetail>, crate::Error> {
        db::update_metadata(
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
        instructions: Option<&str>,
        prep_time_minutes: Option<i32>,
        cook_time_minutes: Option<i32>,
    ) -> Result<Option<UserDishPrefDetail>, crate::Error> {
        db::fork_and_update_recipe(
            &self.pool,
            user_id,
            pref_id,
            name,
            instructions,
            prep_time_minutes,
            cook_time_minutes,
        )
        .await
        .map_err(Into::into)
    }

    async fn delete(&self, user_id: Uuid, pref_id: Uuid) -> Result<bool, crate::Error> {
        db::delete(&self.pool, user_id, pref_id)
            .await
            .map_err(Into::into)
    }

    async fn add_ingredient(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        params: AddIngredientParams,
    ) -> Result<Option<UserDishPrefDetail>, crate::Error> {
        db::add_ingredient(&self.pool, user_id, pref_id, params)
            .await
            .map_err(Into::into)
    }

    async fn remove_ingredient(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        ingredient_id: Uuid,
    ) -> Result<Option<bool>, crate::Error> {
        db::remove_ingredient(&self.pool, user_id, pref_id, ingredient_id)
            .await
            .map_err(Into::into)
    }
}
