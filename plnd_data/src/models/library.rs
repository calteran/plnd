use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// User: Personal dish library
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserDish {
    pub user_dish_id: Uuid,
    pub user_id: Uuid,
    pub catalog_dish_id: Option<Uuid>, // fork origin; no ongoing constraint after fork
    pub name: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
    pub prep_time_minutes: Option<i32>,
    pub cook_time_minutes: Option<i32>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub allergens_overridden: bool,
    pub occasion_tags: Vec<String>,
    pub tags: Vec<String>,
    pub nutrition: Option<Value>,
    pub nutrition_overridden: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserDishIngredient {
    pub user_dish_ingredient_id: Uuid,
    pub user_dish_id: Uuid,
    pub ingredient_id: Uuid, // refs catalog_ingredients only (personal overrides deferred to Phase 3/4)
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
    pub sort_order: i16,
}

// ---------------------------------------------------------------------------
// User: Personal meal library
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserMeal {
    pub user_meal_id: Uuid,
    pub user_id: Uuid,
    pub catalog_meal_id: Option<Uuid>, // fork origin; no ongoing constraint after fork
    pub name: String,
    pub description: Option<String>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub allergens_overridden: bool,
    pub occasion_tags: Vec<String>,
    pub tags: Vec<String>,
    pub nutrition: Option<Value>,
    pub nutrition_overridden: bool,
    pub nutrition_estimated: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserMealDish {
    pub user_meal_dish_id: Uuid,
    pub user_meal_id: Uuid,
    pub catalog_dish_id: Option<Uuid>, // exactly one of catalog_dish_id / user_dish_id must be set (DB CHECK)
    pub user_dish_id: Option<Uuid>,
    pub dish_servings: Decimal,
    pub notes: Option<String>,
    pub sort_order: i16,
}

// ---------------------------------------------------------------------------
// User: Personal exercise library
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserExercise {
    pub user_exercise_id: Uuid,
    pub user_id: Uuid,
    pub catalog_exercise_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub default_duration_minutes: Option<i32>,
    pub intensity: String,
    pub muscle_groups: Vec<String>,
    pub equipment_required: Vec<String>,
    pub tags: Vec<String>,
    pub rating: Option<i16>,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
