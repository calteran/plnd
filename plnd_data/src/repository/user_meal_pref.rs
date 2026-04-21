use async_trait::async_trait;
use uuid::Uuid;

use crate::db::error::DatabaseError;
pub use crate::db::user_meal_prefs::AddDishParams;
use crate::models::UserMealPrefDetail;

#[async_trait]
pub trait UserMealPrefRepository: Send + Sync {
    async fn list(&self, user_id: Uuid) -> Result<Vec<UserMealPrefDetail>, DatabaseError>;

    async fn get(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
    ) -> Result<Option<UserMealPrefDetail>, DatabaseError>;

    async fn create_from_catalog(
        &self,
        user_id: Uuid,
        catalog_meal_id: Uuid,
    ) -> Result<UserMealPrefDetail, DatabaseError>;

    async fn create_from_scratch(
        &self,
        user_id: Uuid,
        name: &str,
        description: Option<&str>,
    ) -> Result<UserMealPrefDetail, DatabaseError>;

    async fn create_from_description(
        &self,
        user_id: Uuid,
        name: &str,
        occasion_tags: &[String],
        nutrition: Option<serde_json::Value>,
        estimated: bool,
    ) -> Result<UserMealPrefDetail, DatabaseError>;

    async fn update_metadata(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        rating: Option<Option<i16>>,
        is_safe_food: Option<bool>,
        is_blocked: Option<bool>,
        notes: Option<Option<String>>,
    ) -> Result<Option<UserMealPrefDetail>, DatabaseError>;

    async fn fork_and_update_recipe(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Option<UserMealPrefDetail>, DatabaseError>;

    async fn delete(&self, user_id: Uuid, pref_id: Uuid) -> Result<bool, DatabaseError>;

    async fn add_dish(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        params: AddDishParams,
    ) -> Result<Option<UserMealPrefDetail>, DatabaseError>;

    async fn remove_dish(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        meal_dish_id: Uuid,
    ) -> Result<Option<bool>, DatabaseError>;
}
