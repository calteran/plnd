// Offline tests for the external client traits, DTOs, and error types.
// No HTTP requests, no database — mirrors the domain_model_test.rs pattern.
use async_trait::async_trait;
use plnd_api::clients::dtos::{
    ExternalDish, ExternalDishIngredient, ExternalExercise, ExternalIngredient, NutritionFacts,
    SearchQuery, SearchResult,
};
use plnd_api::clients::{ExerciseProvider, ExternalClientError, NutritionProvider, RecipeProvider};
use rust_decimal::Decimal;

// ---------------------------------------------------------------------------
// SearchQuery defaults
// ---------------------------------------------------------------------------

#[test]
fn test_search_query_new_defaults() {
    let q = SearchQuery::new("chicken");
    assert_eq!(q.query, "chicken");
    assert_eq!(q.limit, 20);
    assert!(q.exclude_allergens.is_empty());
}

#[test]
fn test_search_query_new_with_string_literal() {
    let q = SearchQuery::new("brown rice");
    assert_eq!(q.query, "brown rice");
}

// ---------------------------------------------------------------------------
// ExternalClientError display messages
// ---------------------------------------------------------------------------

#[test]
fn test_rate_limited_error_with_retry_after() {
    let err = ExternalClientError::RateLimited {
        retry_after_secs: Some(30),
    };
    let msg = err.to_string();
    assert!(
        msg.contains("30"),
        "expected retry seconds in message: {msg}"
    );
    assert!(
        msg.contains("Rate limited"),
        "expected 'Rate limited' in message: {msg}"
    );
}

#[test]
fn test_rate_limited_error_without_retry_after() {
    let err = ExternalClientError::RateLimited {
        retry_after_secs: None,
    };
    let msg = err.to_string();
    assert!(msg.contains("Rate limited"), "{msg}");
}

#[test]
fn test_configuration_error_message() {
    let err = ExternalClientError::ConfigurationError("missing API key".to_string());
    assert_eq!(
        err.to_string(),
        "Client configuration error: missing API key"
    );
}

#[test]
fn test_http_error_message() {
    let err = ExternalClientError::HttpError("connection refused".to_string());
    assert_eq!(err.to_string(), "HTTP request failed: connection refused");
}

#[test]
fn test_unauthorized_message() {
    let err = ExternalClientError::Unauthorized;
    assert!(err.to_string().contains("Unauthorized"));
}

#[test]
fn test_not_found_message() {
    let err = ExternalClientError::NotFound;
    assert!(err.to_string().contains("not found"));
}

// ---------------------------------------------------------------------------
// Serde round-trips
// ---------------------------------------------------------------------------

#[test]
fn test_nutrition_facts_round_trip() {
    let facts = NutritionFacts {
        calories_kcal: Some(95.0),
        protein_g: Some(0.5),
        carbohydrates_g: Some(25.1),
        fat_g: Some(0.3),
        fiber_g: Some(4.4),
        ..Default::default()
    };
    let json = serde_json::to_string(&facts).expect("serialize");
    let back: NutritionFacts = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(facts, back);
}

#[test]
fn test_nutrition_facts_json_has_calories_key() {
    let facts = NutritionFacts {
        calories_kcal: Some(95.0),
        ..Default::default()
    };
    let val = serde_json::to_value(&facts).expect("to_value");
    assert!(
        val.get("calories_kcal").is_some(),
        "expected 'calories_kcal' key in JSON: {val}"
    );
    assert_eq!(val["calories_kcal"], serde_json::json!(95.0));
}

#[test]
fn test_nutrition_facts_default_all_none() {
    let facts = NutritionFacts::default();
    let val = serde_json::to_value(&facts).expect("to_value");
    // All fields should serialize to null (Option::None)
    assert_eq!(val["calories_kcal"], serde_json::Value::Null);
    assert_eq!(val["protein_g"], serde_json::Value::Null);
}

#[test]
fn test_external_ingredient_round_trip() {
    let ingredient = ExternalIngredient {
        external_id: "fdc-12345".to_string(),
        name: "Oat Flour".to_string(),
        serving_size_g: Some(Decimal::new(100, 0)),
        nutrition: Some(NutritionFacts {
            calories_kcal: Some(404.0),
            protein_g: Some(14.7),
            ..Default::default()
        }),
        allergens: vec!["gluten".to_string()],
        occasion_tags: vec!["breakfast".to_string()],
    };
    let json = serde_json::to_string(&ingredient).expect("serialize");
    let back: ExternalIngredient = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(ingredient, back);
}

#[test]
fn test_external_dish_round_trip() {
    let dish = ExternalDish {
        external_id: "sp-9876".to_string(),
        name: "Avocado Toast".to_string(),
        instructions: Some("Toast bread. Mash avocado. Combine.".to_string()),
        prep_time_minutes: Some(5),
        cook_time_minutes: Some(2),
        servings: Decimal::new(2, 0),
        allergens: vec!["gluten".to_string()],
        occasion_tags: vec!["breakfast".to_string(), "snack".to_string()],
        nutrition: None,
        ingredients: vec![ExternalDishIngredient {
            name: "sourdough bread".to_string(),
            external_ingredient_id: None,
            quantity: Decimal::new(2, 0),
            unit: "slices".to_string(),
            preparation_note: Some("toasted".to_string()),
            is_optional: false,
        }],
    };
    let json = serde_json::to_string(&dish).expect("serialize");
    let back: ExternalDish = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(dish, back);
}

#[test]
fn test_search_result_round_trip() {
    let result = SearchResult {
        external_id: "wger-42".to_string(),
        name: "Barbell Squat".to_string(),
        description: Some("Compound lower-body movement".to_string()),
        thumbnail_url: None,
    };
    let json = serde_json::to_string(&result).expect("serialize");
    let back: SearchResult = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(result, back);
}

#[test]
fn test_external_exercise_round_trip() {
    let exercise = ExternalExercise {
        external_id: "wger-101".to_string(),
        name: "Push-up".to_string(),
        description: Some("Classic bodyweight exercise".to_string()),
        muscle_groups: vec!["chest".to_string(), "triceps".to_string()],
        equipment: vec!["none".to_string()],
        intensity: Some("moderate".to_string()),
        duration_minutes: Some(10),
        instructions: Some("Keep body straight. Lower chest to floor.".to_string()),
        tags: vec!["bodyweight".to_string(), "upper_body".to_string()],
    };
    let json = serde_json::to_string(&exercise).expect("serialize");
    let back: ExternalExercise = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(exercise, back);
}

// ---------------------------------------------------------------------------
// Trait object safety — prove all three traits can be boxed as dyn T
// ---------------------------------------------------------------------------

struct MockNutritionProvider;

#[async_trait]
impl NutritionProvider for MockNutritionProvider {
    fn source_name(&self) -> &str {
        "mock_nutrition"
    }
    async fn search_ingredients(
        &self,
        _query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalClientError> {
        Ok(vec![])
    }
    async fn get_ingredient_by_id(
        &self,
        _external_id: &str,
    ) -> Result<Option<ExternalIngredient>, ExternalClientError> {
        Ok(None)
    }
}

struct MockRecipeProvider;

#[async_trait]
impl RecipeProvider for MockRecipeProvider {
    fn source_name(&self) -> &str {
        "mock_recipe"
    }
    async fn search_dishes(
        &self,
        _query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalClientError> {
        Ok(vec![])
    }
    async fn get_dish_by_id(
        &self,
        _external_id: &str,
    ) -> Result<Option<ExternalDish>, ExternalClientError> {
        Ok(None)
    }
}

struct MockExerciseProvider;

#[async_trait]
impl ExerciseProvider for MockExerciseProvider {
    fn source_name(&self) -> &str {
        "mock_exercise"
    }
    async fn search_exercises(
        &self,
        _query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalClientError> {
        Ok(vec![])
    }
    async fn get_exercise_by_id(
        &self,
        _external_id: &str,
    ) -> Result<Option<ExternalExercise>, ExternalClientError> {
        Ok(None)
    }
}

#[test]
fn test_nutrition_provider_object_safety() {
    let provider: Box<dyn NutritionProvider> = Box::new(MockNutritionProvider);
    assert_eq!(provider.source_name(), "mock_nutrition");
}

#[test]
fn test_recipe_provider_object_safety() {
    let provider: Box<dyn RecipeProvider> = Box::new(MockRecipeProvider);
    assert_eq!(provider.source_name(), "mock_recipe");
}

#[test]
fn test_exercise_provider_object_safety() {
    let provider: Box<dyn ExerciseProvider> = Box::new(MockExerciseProvider);
    assert_eq!(provider.source_name(), "mock_exercise");
}
