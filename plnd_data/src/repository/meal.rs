use async_trait::async_trait;
use uuid::Uuid;

use crate::models::{
    CatalogDish, CatalogDishIngredient, CatalogIngredient, CatalogMeal, CatalogMealDish,
    DietaryRestriction,
};

#[async_trait]
pub trait MealRepository: Send + Sync {
    async fn list_dietary_restrictions(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<DietaryRestriction>, crate::Error>;

    /// Creates a dietary restriction for the given user. Returns the new record.
    async fn create_dietary_restriction(
        &self,
        user_id: Uuid,
        restriction_type: &str,
        name: &str,
        notes: Option<&str>,
    ) -> Result<DietaryRestriction, crate::Error>;

    /// Updates the notes on an existing restriction. Returns `Some(record)` on
    /// success, or `None` if no restriction with the given id belongs to user_id.
    async fn update_dietary_restriction(
        &self,
        restriction_id: Uuid,
        user_id: Uuid,
        notes: Option<&str>,
    ) -> Result<Option<DietaryRestriction>, crate::Error>;

    /// Deletes a restriction. Returns `true` if a row was deleted, `false` if
    /// no restriction with the given id belongs to user_id.
    async fn delete_dietary_restriction(
        &self,
        restriction_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, crate::Error>;

    async fn search_catalog_meals(
        &self,
        q: &str,
        limit: i64,
        occasion: Option<&str>,
        exclude_allergens: &[String],
        user_id: Option<Uuid>,
    ) -> Result<Vec<CatalogMeal>, crate::Error>;

    async fn ingredient_names_by_ids(
        &self,
        ids: &[Uuid],
    ) -> Result<Vec<(Uuid, String)>, crate::Error>;

    async fn search_ingredient_nutrition(
        &self,
        q: &str,
        limit: i64,
    ) -> Result<Vec<CatalogIngredient>, crate::Error>;

    /// Returns `None` if the meal_id does not exist, or `Some(Option<nutrition>)`
    /// where the inner `Option` reflects whether nutrition data is stored.
    async fn catalog_meal_nutrition(
        &self,
        meal_id: Uuid,
    ) -> Result<Option<Option<serde_json::Value>>, crate::Error>;

    async fn user_meal_nutrition(
        &self,
        meal_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<(Option<serde_json::Value>, bool)>, crate::Error>;

    async fn catalog_ingredient(&self, id: Uuid)
    -> Result<Option<CatalogIngredient>, crate::Error>;

    async fn catalog_dish(
        &self,
        id: Uuid,
    ) -> Result<Option<(CatalogDish, Vec<CatalogDishIngredient>)>, crate::Error>;

    async fn catalog_meal(
        &self,
        id: Uuid,
    ) -> Result<Option<(CatalogMeal, Vec<CatalogMealDish>)>, crate::Error>;
}
