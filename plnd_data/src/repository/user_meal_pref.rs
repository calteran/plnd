use async_trait::async_trait;
use uuid::Uuid;

pub use crate::models::AddDishParams;
use crate::models::UserMealPrefDetail;

#[async_trait]
pub trait UserMealPrefRepository: Send + Sync {
    async fn list(&self, user_id: Uuid) -> Result<Vec<UserMealPrefDetail>, crate::Error>;

    async fn get(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
    ) -> Result<Option<UserMealPrefDetail>, crate::Error>;

    async fn create_from_catalog(
        &self,
        user_id: Uuid,
        catalog_meal_id: Uuid,
    ) -> Result<UserMealPrefDetail, crate::Error>;

    async fn create_from_scratch(
        &self,
        user_id: Uuid,
        name: &str,
        description: Option<&str>,
    ) -> Result<UserMealPrefDetail, crate::Error>;

    async fn create_from_description(
        &self,
        user_id: Uuid,
        name: &str,
        occasion_tags: &[String],
        nutrition: Option<serde_json::Value>,
        estimated: bool,
    ) -> Result<UserMealPrefDetail, crate::Error>;

    async fn update_metadata(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        rating: Option<Option<i16>>,
        is_safe_food: Option<bool>,
        is_blocked: Option<bool>,
        notes: Option<Option<String>>,
    ) -> Result<Option<UserMealPrefDetail>, crate::Error>;

    async fn fork_and_update_recipe(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Option<UserMealPrefDetail>, crate::Error>;

    async fn delete(&self, user_id: Uuid, pref_id: Uuid) -> Result<bool, crate::Error>;

    async fn add_dish(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        params: AddDishParams,
    ) -> Result<Option<UserMealPrefDetail>, crate::Error>;

    async fn remove_dish(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        meal_dish_id: Uuid,
    ) -> Result<Option<bool>, crate::Error>;
}
