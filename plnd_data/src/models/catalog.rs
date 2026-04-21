use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Catalog: Ingredients (layer 1 — atomic food items)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogIngredient {
    pub ingredient_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub serving_size_g: Option<Decimal>,
    pub nutrition: Option<Value>, // per serving; canonical shape: { calories_kcal, protein_g, fat_g, ... }
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub external_id: Option<String>,
    pub external_source: Option<String>, // 'usda_fdc' | 'openfoodfacts' | null
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Catalog: Dishes (layer 2 — recipes composed of ingredients)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogDish {
    pub dish_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
    pub prep_time_minutes: Option<i32>,
    pub cook_time_minutes: Option<i32>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub allergens_overridden: bool, // true = manually verified, not computed from ingredients
    pub occasion_tags: Vec<String>, // suggestions only — no DB CHECK
    pub tags: Vec<String>,
    pub nutrition: Option<Value>, // per serving; null = compute from ingredients
    pub nutrition_overridden: bool,
    pub external_id: Option<String>,
    pub external_source: Option<String>, // 'themealdb' | null
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogDishIngredient {
    pub dish_ingredient_id: Uuid,
    pub dish_id: Uuid,
    pub ingredient_id: Uuid,
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
    pub sort_order: i16,
}

// ---------------------------------------------------------------------------
// Catalog: Meals (layer 3 — eating occasion templates composed of dishes)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogMeal {
    pub meal_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub allergens_overridden: bool,
    pub occasion_tags: Vec<String>, // replaces meal_type enum; suggestions only
    pub tags: Vec<String>,
    pub nutrition: Option<Value>, // per person; null = compute from dishes
    pub nutrition_overridden: bool,
    pub external_id: Option<String>,
    pub external_source: Option<String>, // reserved for future meal-level providers
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogMealDish {
    pub meal_dish_id: Uuid,
    pub meal_id: Uuid,
    pub dish_id: Uuid,
    pub dish_servings: Decimal,
    pub notes: Option<String>,
    pub sort_order: i16,
}

// ---------------------------------------------------------------------------
// Catalog: Exercises
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogExercise {
    pub exercise_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub default_duration_minutes: Option<i32>,
    pub intensity: String, // 'low' | 'moderate' | 'high'
    pub muscle_groups: Vec<String>,
    pub equipment_required: Vec<String>,
    pub tags: Vec<String>,
    pub external_id: Option<String>,
    pub external_source: Option<String>, // 'wger' | null
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
