use async_trait::async_trait;
use uuid::Uuid;

pub use crate::models::AddIngredientParams;
use crate::models::UserDishPrefDetail;

#[async_trait]
pub trait UserDishPrefRepository: Send + Sync {
    async fn list(&self, user_id: Uuid) -> Result<Vec<UserDishPrefDetail>,crate::Error>;

    async fn get(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
    ) -> Result<Option<UserDishPrefDetail>,crate::Error>;

    async fn create_from_catalog(
        &self,
        user_id: Uuid,
        catalog_dish_id: Uuid,
    ) -> Result<UserDishPrefDetail,crate::Error>;

    async fn create_from_scratch(
        &self,
        user_id: Uuid,
        name: &str,
        instructions: Option<&str>,
        prep_time_minutes: Option<i32>,
        cook_time_minutes: Option<i32>,
    ) -> Result<UserDishPrefDetail,crate::Error>;

    async fn update_metadata(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        rating: Option<Option<i16>>,
        is_safe_food: Option<bool>,
        is_blocked: Option<bool>,
        notes: Option<Option<String>>,
    ) -> Result<Option<UserDishPrefDetail>,crate::Error>;

    async fn fork_and_update_recipe(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        name: Option<&str>,
        instructions: Option<&str>,
        prep_time_minutes: Option<i32>,
        cook_time_minutes: Option<i32>,
    ) -> Result<Option<UserDishPrefDetail>,crate::Error>;

    async fn delete(&self, user_id: Uuid, pref_id: Uuid) -> Result<bool,crate::Error>;

    async fn add_ingredient(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        params: AddIngredientParams,
    ) -> Result<Option<UserDishPrefDetail>,crate::Error>;

    async fn remove_ingredient(
        &self,
        user_id: Uuid,
        pref_id: Uuid,
        ingredient_id: Uuid,
    ) -> Result<Option<bool>,crate::Error>;
}
