use std::collections::HashMap;

use async_trait::async_trait;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::providers::dtos::{ExternalDish, ExternalDishIngredient, SearchQuery, SearchResult};
use crate::providers::error::ExternalProviderError;
use crate::providers::recipe::RecipeProvider;

pub struct TheMealDbProvider {
    http: Client,
    base_url: String,
}

impl TheMealDbProvider {
    pub fn new(api_key: &str) -> Self {
        Self {
            http: super::build_http_client(),
            base_url: format!("https://www.themealdb.com/api/json/v1/{}", api_key),
        }
    }
}

// ---------------------------------------------------------------------------
// Internal response types — serde-only, not part of the public API
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct MdbSearchResponse {
    meals: Option<Vec<MdbMeal>>,
}

#[derive(Deserialize)]
struct MdbMeal {
    #[serde(rename = "idMeal")]
    id_meal: String,
    #[serde(rename = "strMeal")]
    str_meal: String,
    #[serde(rename = "strCategory")]
    str_category: Option<String>,
    #[serde(rename = "strInstructions")]
    str_instructions: Option<String>,
    #[serde(rename = "strMealThumb")]
    str_meal_thumb: Option<String>,
    /// Captures strIngredient1–20, strMeasure1–20, and all other dynamic fields
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Map TheMealDB category string to occasion_tags for `ExternalDish`.
fn category_to_occasion_tags(category: &str) -> Vec<String> {
    let tag = match category {
        "Breakfast" => "breakfast-friendly",
        "Dessert" => "dessert",
        "Side" => "side-dish",
        "Starter" => "starter",
        "Vegan" => "vegan",
        "Vegetarian" => "vegetarian",
        "Seafood" => "seafood",
        "Pasta" | "Pork" | "Beef" | "Chicken" | "Lamb" | "Goat" | "Miscellaneous" => "dinner",
        _ => return vec![],
    };
    vec![tag.to_string()]
}

/// Parse a TheMealDB measure string (e.g. "1 cup", "250g", "1/2 cup") into
/// a (quantity, unit) pair. Falls back to (ONE, "serving") for unparseable input.
fn parse_measure(s: &str) -> (Decimal, String) {
    let s = s.trim();
    if s.is_empty() {
        return (Decimal::ONE, "serving".to_string());
    }

    // Case: has a space — split quantity from unit
    if let Some(space_pos) = s.find(' ') {
        let qty_str = &s[..space_pos];
        let unit_str = s[space_pos + 1..].trim();

        // Sub-case: fraction like "1/2"
        if qty_str.contains('/')
            && let Some(dec) = parse_fraction(qty_str)
        {
            let unit = if unit_str.is_empty() {
                "serving".to_string()
            } else {
                unit_str.to_string()
            };
            return (dec, unit);
        }

        // Sub-case: plain number like "1" or "250"
        if let Ok(qty) = qty_str.parse::<f64>()
            && let Ok(d) = Decimal::try_from(qty)
        {
            let unit = if unit_str.is_empty() {
                "serving".to_string()
            } else {
                unit_str.to_string()
            };
            return (d, unit);
        }
    }

    // Case: no space — try "250g" pattern (digits/dot then letters)
    let unit_start = s
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(s.len());
    if unit_start > 0 {
        let qty_str = &s[..unit_start];
        let unit = s[unit_start..].trim();
        if let Ok(qty) = qty_str.parse::<f64>()
            && let Ok(d) = Decimal::try_from(qty)
        {
            let unit = if unit.is_empty() {
                "serving".to_string()
            } else {
                unit.to_string()
            };
            return (d, unit);
        }
    }

    // Unparseable (e.g. "to taste")
    (Decimal::ONE, "serving".to_string())
}

fn parse_fraction(s: &str) -> Option<Decimal> {
    let mut parts = s.split('/');
    let num = parts.next()?.parse::<f64>().ok()?;
    let den = parts.next()?.parse::<f64>().ok()?;
    if den == 0.0 {
        return None;
    }
    Decimal::try_from(num / den).ok()
}

/// Extract ingredients from the dynamic strIngredient1–20 / strMeasure1–20 fields.
/// Stops at the first empty ingredient slot (TheMealDB fills them in order).
fn extract_ingredients(meal: &MdbMeal) -> Vec<ExternalDishIngredient> {
    let mut ingredients = Vec::new();
    for i in 1..=20 {
        let ing_key = format!("strIngredient{}", i);
        let meas_key = format!("strMeasure{}", i);

        let name = match meal.extra.get(&ing_key).and_then(|v| v.as_str()) {
            Some(n) if !n.trim().is_empty() => n.trim().to_string(),
            _ => break,
        };

        let measure = meal
            .extra
            .get(&meas_key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let (quantity, unit) = parse_measure(&measure);

        ingredients.push(ExternalDishIngredient {
            name,
            external_ingredient_id: None,
            quantity,
            unit,
            preparation_note: None,
            is_optional: false,
        });
    }
    ingredients
}

fn meal_to_dish(meal: MdbMeal) -> ExternalDish {
    let occasion_tags = meal
        .str_category
        .as_deref()
        .map(category_to_occasion_tags)
        .unwrap_or_default();
    let ingredients = extract_ingredients(&meal);

    ExternalDish {
        external_id: meal.id_meal,
        name: meal.str_meal,
        instructions: meal.str_instructions,
        prep_time_minutes: None,
        cook_time_minutes: None,
        servings: Decimal::from(4u32), // TheMealDB has no servings field
        allergens: vec![],             // TheMealDB provides no allergen data
        occasion_tags,
        nutrition: None, // TheMealDB provides no nutrition data
        ingredients,
    }
}

/// Parse a raw TheMealDB API meal JSON object into an [`ExternalDish`].
///
/// Used by the debug-only [`TheMealDbFixtureProvider`] so that fixtures apply
/// the same `parse_measure` logic as the live provider, eliminating
/// fixture-vs-live divergence for ingredient quantities and units.
pub fn parse_meal_json(value: serde_json::Value) -> Result<ExternalDish, serde_json::Error> {
    let meal: MdbMeal = serde_json::from_value(value)?;
    Ok(meal_to_dish(meal))
}

// ---------------------------------------------------------------------------
// Fixture-backed provider (debug builds only)
// ---------------------------------------------------------------------------

/// Fixture-backed `RecipeProvider` for e2e tests.
///
/// Reads `search.json` (`HashMap<term, Vec<SearchResult>>`) for search and
/// `lookup.json` (`HashMap<idMeal, raw TheMealDB meal JSON>`) for lookups.
/// Ingredient quantities/units are parsed at load time by [`parse_meal_json`],
/// guaranteeing the same output as the live [`TheMealDbProvider`].
#[cfg(debug_assertions)]
#[derive(Debug)]
pub struct TheMealDbFixtureProvider {
    search_path: std::path::PathBuf,
    lookup_path: std::path::PathBuf,
}

#[cfg(debug_assertions)]
impl TheMealDbFixtureProvider {
    pub fn new(
        search_path: std::path::PathBuf,
        lookup_path: std::path::PathBuf,
    ) -> Result<Self, ExternalProviderError> {
        if !search_path.is_file() {
            return Err(ExternalProviderError::ConfigurationError(format!(
                "fixture search file not found: {}",
                search_path.display()
            )));
        }
        if !lookup_path.is_file() {
            return Err(ExternalProviderError::ConfigurationError(format!(
                "fixture lookup file not found: {}",
                lookup_path.display()
            )));
        }
        Ok(Self {
            search_path,
            lookup_path,
        })
    }
}

#[cfg(debug_assertions)]
#[async_trait]
impl RecipeProvider for TheMealDbFixtureProvider {
    fn source_name(&self) -> &str {
        "themealdb"
    }

    #[tracing::instrument(
        name = "provider::themealdb_fixture::search_dishes",
        skip(self),
        fields(provider = "themealdb_fixture")
    )]
    async fn search_dishes(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalProviderError> {
        let bytes = std::fs::read(&self.search_path).map_err(|e| {
            ExternalProviderError::ConfigurationError(format!(
                "failed to read fixture {}: {e}",
                self.search_path.display()
            ))
        })?;
        let by_query: HashMap<String, Vec<SearchResult>> = serde_json::from_slice(&bytes)
            .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string()))?;
        let mut results = by_query
            .get(&query.query.to_lowercase())
            .cloned()
            .unwrap_or_default();
        results.truncate(query.limit as usize);
        Ok(results)
    }

    #[tracing::instrument(
        name = "provider::themealdb_fixture::get_dish_by_id",
        skip(self),
        fields(provider = "themealdb_fixture", external_id = %external_id)
    )]
    async fn get_dish_by_id(
        &self,
        external_id: &str,
    ) -> Result<Option<ExternalDish>, ExternalProviderError> {
        let bytes = std::fs::read(&self.lookup_path).map_err(|e| {
            ExternalProviderError::ConfigurationError(format!(
                "failed to read fixture {}: {e}",
                self.lookup_path.display()
            ))
        })?;
        let lookup: HashMap<String, serde_json::Value> = serde_json::from_slice(&bytes)
            .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string()))?;
        match lookup.get(external_id) {
            None => Ok(None),
            Some(v) => parse_meal_json(v.clone())
                .map(Some)
                .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string())),
        }
    }
}

// ---------------------------------------------------------------------------
// RecipeProvider impl
// ---------------------------------------------------------------------------

#[async_trait]
impl RecipeProvider for TheMealDbProvider {
    fn source_name(&self) -> &str {
        "themealdb"
    }

    #[tracing::instrument(
        name = "provider::themealdb::search_dishes",
        skip(self),
        fields(provider = "themealdb")
    )]
    async fn search_dishes(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalProviderError> {
        // exclude_allergens cannot be applied: TheMealDB provides no allergen data
        let url = format!("{}/search.php", self.base_url);
        let resp = self
            .http
            .get(&url)
            .query(&[("s", query.query.as_str())])
            .send()
            .await?;

        let status = resp.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(ExternalProviderError::Unauthorized);
        }
        if status.as_u16() == 429 {
            let retry_after_secs = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok());
            return Err(ExternalProviderError::RateLimited { retry_after_secs });
        }
        if !status.is_success() {
            return Err(ExternalProviderError::HttpError(format!(
                "HTTP {}",
                status.as_u16()
            )));
        }

        let body: MdbSearchResponse = resp
            .json()
            .await
            .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string()))?;

        let results = body
            .meals
            .unwrap_or_default()
            .into_iter()
            .map(|m| SearchResult {
                external_id: m.id_meal,
                name: m.str_meal,
                description: m.str_category,
                thumbnail_url: m.str_meal_thumb,
            })
            .collect();

        Ok(results)
    }

    #[tracing::instrument(name = "provider::themealdb::get_dish_by_id", skip(self), fields(provider = "themealdb", external_id = %external_id))]
    async fn get_dish_by_id(
        &self,
        external_id: &str,
    ) -> Result<Option<ExternalDish>, ExternalProviderError> {
        let url = format!("{}/lookup.php", self.base_url);
        let resp = self
            .http
            .get(&url)
            .query(&[("i", external_id)])
            .send()
            .await?;

        let status = resp.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(ExternalProviderError::Unauthorized);
        }
        if status.as_u16() == 429 {
            let retry_after_secs = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok());
            return Err(ExternalProviderError::RateLimited { retry_after_secs });
        }
        if !status.is_success() {
            return Err(ExternalProviderError::HttpError(format!(
                "HTTP {}",
                status.as_u16()
            )));
        }

        let body: MdbSearchResponse = resp
            .json()
            .await
            .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string()))?;

        Ok(body.meals.and_then(|mut m| m.pop()).map(meal_to_dish))
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::prelude::FromStr;

    #[test]
    fn test_parse_measure_empty() {
        let (qty, unit) = parse_measure("");
        assert_eq!(qty, Decimal::ONE);
        assert_eq!(unit, "serving");
    }

    #[test]
    fn test_parse_measure_number_with_unit() {
        let (qty, unit) = parse_measure("1 cup");
        assert_eq!(qty, Decimal::from(1u32));
        assert_eq!(unit, "cup");
    }

    #[test]
    fn test_parse_measure_number_attached_to_unit() {
        let (qty, unit) = parse_measure("250g");
        assert_eq!(qty, Decimal::from(250u32));
        assert_eq!(unit, "g");
    }

    #[test]
    fn test_parse_measure_fraction() {
        let (qty, unit) = parse_measure("1/2 cup");
        let expected = Decimal::from_str("0.5").unwrap();
        assert_eq!(qty, expected);
        assert_eq!(unit, "cup");
    }

    #[test]
    fn test_parse_measure_to_taste_returns_default() {
        let (qty, unit) = parse_measure("to taste");
        assert_eq!(qty, Decimal::ONE);
        assert_eq!(unit, "serving");
    }

    #[test]
    fn test_category_to_occasion_tags_breakfast() {
        assert_eq!(
            category_to_occasion_tags("Breakfast"),
            vec!["breakfast-friendly"]
        );
    }

    #[test]
    fn test_category_to_occasion_tags_dessert() {
        assert_eq!(category_to_occasion_tags("Dessert"), vec!["dessert"]);
    }

    #[test]
    fn test_category_to_occasion_tags_beef() {
        assert_eq!(category_to_occasion_tags("Beef"), vec!["dinner"]);
    }

    #[test]
    fn test_category_to_occasion_tags_unknown() {
        let tags = category_to_occasion_tags("SomeUnknownCategory");
        assert!(tags.is_empty());
    }

    #[test]
    fn test_extract_ingredients_stops_at_first_empty_slot() {
        let mut extra = HashMap::new();
        extra.insert("strIngredient1".to_string(), serde_json::json!("Chicken"));
        extra.insert("strMeasure1".to_string(), serde_json::json!("1 cup"));
        extra.insert("strIngredient2".to_string(), serde_json::json!(""));
        extra.insert("strMeasure2".to_string(), serde_json::json!(""));
        extra.insert("strIngredient3".to_string(), serde_json::json!("Rice"));
        extra.insert("strMeasure3".to_string(), serde_json::json!("2 cups"));

        let meal = MdbMeal {
            id_meal: "1".to_string(),
            str_meal: "Test".to_string(),
            str_category: None,
            str_instructions: None,
            str_meal_thumb: None,
            extra,
        };

        let ingredients = extract_ingredients(&meal);
        assert_eq!(ingredients.len(), 1);
        assert_eq!(ingredients[0].name, "Chicken");
    }

    #[test]
    fn test_mdb_search_response_meals_null_deserializes() {
        let json = r#"{"meals": null}"#;
        let resp: MdbSearchResponse = serde_json::from_str(json).expect("deserialize");
        assert!(resp.meals.is_none());
    }

    #[test]
    fn parse_meal_json_maps_ingredients_with_correct_quantity_and_unit() {
        use rust_decimal::prelude::FromStr;
        let json = serde_json::json!({
            "idMeal": "52795", "strMeal": "Chicken Handi",
            "strCategory": "Chicken", "strInstructions": "Cook it.",
            "strMealThumb": serde_json::Value::Null,
            "strIngredient1": "Chicken", "strMeasure1": "1.2 kg",
            "strIngredient2": "Onion",   "strMeasure2": "5 thinly sliced",
            "strIngredient3": "",        "strMeasure3": ""
        });
        let dish = parse_meal_json(json).expect("should parse");
        assert_eq!(dish.ingredients.len(), 2);
        assert_eq!(
            dish.ingredients[0].quantity,
            Decimal::from_str("1.2").unwrap()
        );
        assert_eq!(dish.ingredients[0].unit, "kg");
        assert_eq!(dish.ingredients[1].quantity, Decimal::from(5u32));
        assert_eq!(dish.ingredients[1].unit, "thinly sliced");
    }

    #[test]
    fn parse_meal_json_returns_error_for_non_object_value() {
        assert!(parse_meal_json(serde_json::json!("not an object")).is_err());
    }

    #[cfg(debug_assertions)]
    mod fixture_tests {
        use super::*;
        use rust_decimal::prelude::FromStr;
        use std::path::PathBuf;

        fn write_fixtures(dir: &std::path::Path) -> (PathBuf, PathBuf) {
            let search = dir.join("search.json");
            let lookup = dir.join("lookup.json");
            std::fs::write(
                &search,
                r#"{"chicken": [{"external_id":"52795","name":"Chicken Handi","description":"Chicken","thumbnail_url":null}]}"#,
            )
            .unwrap();
            std::fs::write(
                &lookup,
                r#"{
                    "52795": {"idMeal":"52795","strMeal":"Chicken Handi","strCategory":"Chicken",
                              "strInstructions":"Cook it.","strMealThumb":null,
                              "strIngredient1":"Chicken","strMeasure1":"1.2 kg",
                              "strIngredient2":"","strMeasure2":""}
                }"#,
            )
            .unwrap();
            (search, lookup)
        }

        #[tokio::test]
        async fn search_dishes_returns_results_for_known_term() {
            let tmp = tempfile::tempdir().unwrap();
            let (s, l) = write_fixtures(tmp.path());
            let p = TheMealDbFixtureProvider::new(s, l).unwrap();
            let results = p.search_dishes(&SearchQuery::new("chicken")).await.unwrap();
            assert_eq!(results.len(), 1);
            assert_eq!(results[0].external_id, "52795");
        }

        #[tokio::test]
        async fn get_dish_by_id_parses_measures_via_parse_meal_json() {
            let tmp = tempfile::tempdir().unwrap();
            let (s, l) = write_fixtures(tmp.path());
            let p = TheMealDbFixtureProvider::new(s, l).unwrap();
            let dish = p.get_dish_by_id("52795").await.unwrap().expect("found");
            assert_eq!(
                dish.ingredients[0].quantity,
                Decimal::from_str("1.2").unwrap()
            );
            assert_eq!(dish.ingredients[0].unit, "kg");
        }

        #[tokio::test]
        async fn get_dish_by_id_returns_none_for_unknown_id() {
            let tmp = tempfile::tempdir().unwrap();
            let (s, l) = write_fixtures(tmp.path());
            let p = TheMealDbFixtureProvider::new(s, l).unwrap();
            assert!(p.get_dish_by_id("unknown").await.unwrap().is_none());
        }

        #[test]
        fn new_returns_error_when_search_path_missing() {
            let tmp = tempfile::tempdir().unwrap();
            let lookup = tmp.path().join("lookup.json");
            std::fs::write(&lookup, "{}").unwrap();
            let err = TheMealDbFixtureProvider::new(PathBuf::from("/no/search.json"), lookup)
                .unwrap_err();
            assert!(matches!(err, ExternalProviderError::ConfigurationError(_)));
        }
    }
}
