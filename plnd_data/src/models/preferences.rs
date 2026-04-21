use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// User: Dish and Meal preference records (aggregate roots)
// ---------------------------------------------------------------------------

/// Stable handle for a user's relationship with a dish.
/// The client always uses user_dish_pref_id — it never changes even after a fork.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserDishPref {
    pub user_dish_pref_id: Uuid,
    pub user_id: Uuid,
    pub catalog_dish_id: Option<Uuid>,
    pub user_dish_id: Option<Uuid>,
    pub rating: Option<i16>,
    pub is_safe_food: bool,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// UserDishPref enriched with display fields computed by the list/detail query.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserDishPrefDetail {
    pub user_dish_pref_id: Uuid,
    pub user_id: Uuid,
    pub catalog_dish_id: Option<Uuid>,
    pub user_dish_id: Option<Uuid>,
    pub rating: Option<i16>,
    pub is_safe_food: bool,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Computed fields from JOIN
    pub name: String,
    pub source: String, // "catalog" | "personal"
    pub has_personal_recipe: bool,
    pub origin_external_source: Option<String>,
}

/// Stable handle for a user's relationship with a meal.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserMealPref {
    pub user_meal_pref_id: Uuid,
    pub user_id: Uuid,
    pub catalog_meal_id: Option<Uuid>,
    pub user_meal_id: Option<Uuid>,
    pub rating: Option<i16>,
    pub is_safe_food: bool,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// UserMealPref enriched with display fields computed by the list/detail query.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserMealPrefDetail {
    pub user_meal_pref_id: Uuid,
    pub user_id: Uuid,
    pub catalog_meal_id: Option<Uuid>,
    pub user_meal_id: Option<Uuid>,
    pub rating: Option<i16>,
    pub is_safe_food: bool,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Computed fields from JOIN
    pub name: String,
    pub source: String, // "catalog" | "personal"
    pub has_personal_recipe: bool,
    pub origin_external_source: Option<String>,
    pub nutrition_estimated: bool,
}

/// User preference for a catalog ingredient (blocked/notes only — no fork concept for ingredients).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserIngredientPref {
    pub user_ingredient_pref_id: Uuid,
    pub user_id: Uuid,
    pub catalog_ingredient_id: Uuid,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Parameters for adding an ingredient to a user dish (via fork if needed).
pub struct AddIngredientParams {
    pub ingredient_id: Uuid,
    pub quantity: rust_decimal::Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
    pub sort_order: i16,
}
