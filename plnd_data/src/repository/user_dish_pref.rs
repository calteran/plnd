use async_trait::async_trait;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::UserDishPrefDetail;
pub use crate::db::user_dish_prefs::AddIngredientParams;

#[async_trait]
pub trait UserDishPrefRepository: Send + Sync {
    async fn list(&self, user_id: Uuid) -> Result<Vec<UserDishPrefDetail>, DatabaseError>;

    async fn get(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
    ) -> Result<Option<UserDishPrefDetail>, DatabaseError>;

    async fn create_from_catalog(
        &self,
        user_id: Uuid,
        catalog_dish_id: Uuid,
    ) -> Result<UserDishPrefDetail, DatabaseError>;

    async fn create_from_scratch(
        &self,
        user_id: Uuid,
        name: &str,
        instructions: Option<&str>,
        prep_time_minutes: Option<i32>,
        cook_time_minutes: Option<i32>,
    ) -> Result<UserDishPrefDetail, DatabaseError>;

    async fn update_metadata(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        rating: Option<Option<i16>>,
        is_safe_food: Option<bool>,
        is_blocked: Option<bool>,
        notes: Option<Option<String>>,
    ) -> Result<Option<UserDishPrefDetail>, DatabaseError>;

    async fn fork_and_update_recipe(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        name: Option<&str>,
        instructions: Option<&str>,
        prep_time_minutes: Option<i32>,
        cook_time_minutes: Option<i32>,
    ) -> Result<Option<UserDishPrefDetail>, DatabaseError>;

    async fn delete(&self, user_id: Uuid, pref_id: Uuid) -> Result<bool, DatabaseError>;

    async fn add_ingredient(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        params: AddIngredientParams,
    ) -> Result<Option<UserDishPrefDetail>, DatabaseError>;

    async fn remove_ingredient(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        ingredient_id: Uuid,
    ) -> Result<Option<bool>, DatabaseError>;
}
