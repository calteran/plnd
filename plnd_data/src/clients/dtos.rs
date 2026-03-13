use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Nutrition data matching the canonical `nutrition JSONB` shape in `catalog_ingredients`.
/// All fields are `Option<f64>` so partial data from providers round-trips cleanly.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct NutritionFacts {
    pub calories_kcal: Option<f64>,
    pub protein_g: Option<f64>,
    pub carbohydrates_g: Option<f64>,
    pub fat_g: Option<f64>,
    pub fiber_g: Option<f64>,
    pub sugar_g: Option<f64>,
    pub sodium_mg: Option<f64>,
    pub potassium_mg: Option<f64>,
    pub calcium_mg: Option<f64>,
    pub iron_mg: Option<f64>,
    pub vitamin_c_mg: Option<f64>,
    pub vitamin_d_iu: Option<f64>,
    pub saturated_fat_g: Option<f64>,
    pub cholesterol_mg: Option<f64>,
}

/// A single ingredient as returned by a `NutritionProvider`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalIngredient {
    pub external_id: String,
    pub name: String,
    pub serving_size_g: Option<Decimal>,
    pub nutrition: Option<NutritionFacts>,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
}

/// An ingredient line within an `ExternalDish`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalDishIngredient {
    pub name: String,
    pub external_ingredient_id: Option<String>,
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
}

/// A complete dish (recipe) as returned by a `RecipeProvider`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalDish {
    pub external_id: String,
    pub name: String,
    pub instructions: Option<String>,
    pub prep_time_minutes: Option<i32>,
    pub cook_time_minutes: Option<i32>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub nutrition: Option<NutritionFacts>,
    pub ingredients: Vec<ExternalDishIngredient>,
}

/// An exercise as returned by an `ExerciseProvider`.
/// `intensity` should be normalized to `VALID_INTENSITY_LEVELS` ("low", "moderate", "high")
/// by each concrete implementor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalExercise {
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    pub muscle_groups: Vec<String>,
    pub equipment: Vec<String>,
    /// Normalized to "low" | "moderate" | "high" by the concrete provider.
    pub intensity: Option<String>,
    pub duration_minutes: Option<i32>,
    pub instructions: Option<String>,
    pub tags: Vec<String>,
}

/// Lightweight summary used by all three provider `search_*` methods.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchResult {
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
}

/// Query parameters shared by all three provider `search_*` methods.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub query: String,
    /// Maximum number of results to return. Defaults to 20.
    pub limit: u32,
    /// Allergens to exclude from results.
    pub exclude_allergens: Vec<String>,
}

impl SearchQuery {
    /// Construct a query with sensible defaults: limit=20, no allergen exclusions.
    pub fn new(query: impl Into<String>) -> Self {
        Self {
            query: query.into(),
            limit: 20,
            exclude_allergens: Vec::new(),
        }
    }
}
