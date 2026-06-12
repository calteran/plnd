use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Geographic coordinate pair used by weather and news providers.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
}

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

impl NutritionFacts {
    /// Scale every present macro by `factor`, leaving absent (`None`) fields absent.
    ///
    /// Provider nutrition is reported per 100 g (USDA FDC and Open Food Facts both
    /// normalise to `*_100g`), so a gram quantity `g` scales by `g / 100.0`.
    pub fn scaled(&self, factor: f64) -> NutritionFacts {
        let s = |v: Option<f64>| v.map(|x| x * factor);
        NutritionFacts {
            calories_kcal: s(self.calories_kcal),
            protein_g: s(self.protein_g),
            carbohydrates_g: s(self.carbohydrates_g),
            fat_g: s(self.fat_g),
            fiber_g: s(self.fiber_g),
            sugar_g: s(self.sugar_g),
            sodium_mg: s(self.sodium_mg),
            potassium_mg: s(self.potassium_mg),
            calcium_mg: s(self.calcium_mg),
            iron_mg: s(self.iron_mg),
            vitamin_c_mg: s(self.vitamin_c_mg),
            vitamin_d_iu: s(self.vitamin_d_iu),
            saturated_fat_g: s(self.saturated_fat_g),
            cholesterol_mg: s(self.cholesterol_mg),
        }
    }

    /// Sum two fact sets field-wise. A field is `Some` if either operand has it
    /// (absent treated as 0); it stays `None` only when both operands are absent,
    /// so summing ingredients never fabricates a `0.0` for data nobody reported.
    pub fn plus(&self, other: &NutritionFacts) -> NutritionFacts {
        let a = |x: Option<f64>, y: Option<f64>| match (x, y) {
            (None, None) => None,
            (a, b) => Some(a.unwrap_or(0.0) + b.unwrap_or(0.0)),
        };
        NutritionFacts {
            calories_kcal: a(self.calories_kcal, other.calories_kcal),
            protein_g: a(self.protein_g, other.protein_g),
            carbohydrates_g: a(self.carbohydrates_g, other.carbohydrates_g),
            fat_g: a(self.fat_g, other.fat_g),
            fiber_g: a(self.fiber_g, other.fiber_g),
            sugar_g: a(self.sugar_g, other.sugar_g),
            sodium_mg: a(self.sodium_mg, other.sodium_mg),
            potassium_mg: a(self.potassium_mg, other.potassium_mg),
            calcium_mg: a(self.calcium_mg, other.calcium_mg),
            iron_mg: a(self.iron_mg, other.iron_mg),
            vitamin_c_mg: a(self.vitamin_c_mg, other.vitamin_c_mg),
            vitamin_d_iu: a(self.vitamin_d_iu, other.vitamin_d_iu),
            saturated_fat_g: a(self.saturated_fat_g, other.saturated_fat_g),
            cholesterol_mg: a(self.cholesterol_mg, other.cholesterol_mg),
        }
    }
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ExternalDishIngredient {
    pub name: String,
    pub external_ingredient_id: Option<String>,
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
}

/// A complete dish (recipe) as returned by a `RecipeProvider`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SearchResult {
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
}

#[cfg(test)]
mod nutrition_facts_tests {
    use super::NutritionFacts;

    #[test]
    fn scaled_multiplies_present_fields_and_leaves_none() {
        let facts = NutritionFacts {
            calories_kcal: Some(200.0),
            protein_g: Some(10.0),
            // carbohydrates_g intentionally absent
            sodium_mg: Some(50.0),
            ..Default::default()
        };

        // 150 g of a per-100g fact set scales by 1.5.
        let scaled = facts.scaled(1.5);

        assert_eq!(scaled.calories_kcal, Some(300.0));
        assert_eq!(scaled.protein_g, Some(15.0));
        assert_eq!(scaled.sodium_mg, Some(75.0));
        assert_eq!(scaled.carbohydrates_g, None, "absent fields stay absent");
    }

    #[test]
    fn plus_adds_field_wise_and_preserves_none() {
        let a = NutritionFacts {
            calories_kcal: Some(100.0),
            protein_g: Some(5.0),
            ..Default::default()
        };
        let b = NutritionFacts {
            calories_kcal: Some(50.0),
            // protein absent here
            fat_g: Some(3.0),
            ..Default::default()
        };

        let sum = a.plus(&b);

        assert_eq!(sum.calories_kcal, Some(150.0), "both present → summed");
        assert_eq!(sum.protein_g, Some(5.0), "present + absent → present value");
        assert_eq!(sum.fat_g, Some(3.0), "absent + present → present value");
        assert_eq!(sum.fiber_g, None, "absent + absent → absent");
    }
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
