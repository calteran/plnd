use async_trait::async_trait;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::{
    CatalogDish, CatalogDishIngredient, CatalogIngredient, CatalogMeal, CatalogMealDish,
    DietaryRestriction, UserIngredientPref, UserMealPrefDetail,
};

#[async_trait]
pub trait MealRepository: Send + Sync {
    async fn list_dietary_restrictions(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<DietaryRestriction>, DatabaseError>;

    /// Creates a dietary restriction for the given user. Returns the new record.
    async fn create_dietary_restriction(
        &self,
        user_id: Uuid,
        restriction_type: &str,
        name: &str,
        notes: Option<&str>,
    ) -> Result<DietaryRestriction, DatabaseError>;

    /// Updates the notes on an existing restriction. Returns `Some(record)` on
    /// success, or `None` if no restriction with the given id belongs to user_id.
    async fn update_dietary_restriction(
        &self,
        restriction_id: Uuid,
        user_id: Uuid,
        notes: Option<&str>,
    ) -> Result<Option<DietaryRestriction>, DatabaseError>;

    /// Deletes a restriction. Returns `true` if a row was deleted, `false` if
    /// no restriction with the given id belongs to user_id.
    async fn delete_dietary_restriction(
        &self,
        restriction_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, DatabaseError>;

    async fn search_catalog_meals(
        &self,
        q: &str,
        limit: i64,
        occasion: Option<&str>,
        exclude_allergens: &[String],
        user_id: Option<Uuid>,
    ) -> Result<Vec<CatalogMeal>, DatabaseError>;

    async fn list_user_meal_prefs(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<UserMealPrefDetail>, DatabaseError>;

    async fn list_user_ingredient_prefs(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<UserIngredientPref>, DatabaseError>;

    async fn ingredient_names_by_ids(
        &self,
        ids: &[Uuid],
    ) -> Result<Vec<(Uuid, String)>, DatabaseError>;

    async fn search_ingredient_nutrition(
        &self,
        q: &str,
        limit: i64,
    ) -> Result<Vec<CatalogIngredient>, DatabaseError>;

    /// Returns `None` if the meal_id does not exist, or `Some(Option<nutrition>)`
    /// where the inner `Option` reflects whether nutrition data is stored.
    async fn catalog_meal_nutrition(
        &self,
        meal_id: Uuid,
    ) -> Result<Option<Option<serde_json::Value>>, DatabaseError>;

    async fn user_meal_nutrition(
        &self,
        meal_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<(Option<serde_json::Value>, bool)>, DatabaseError>;

    async fn create_user_meal_pref_from_description(
        &self,
        user_id: Uuid,
        name: &str,
        occasion_tags: &[String],
        nutrition: Option<serde_json::Value>,
        estimated: bool,
    ) -> Result<UserMealPrefDetail, DatabaseError>;

    async fn catalog_ingredient(
        &self,
        id: Uuid,
    ) -> Result<Option<CatalogIngredient>, DatabaseError>;

    async fn catalog_dish(
        &self,
        id: Uuid,
    ) -> Result<Option<(CatalogDish, Vec<CatalogDishIngredient>)>, DatabaseError>;

    async fn catalog_meal(
        &self,
        id: Uuid,
    ) -> Result<Option<(CatalogMeal, Vec<CatalogMealDish>)>, DatabaseError>;
}
