use std::collections::HashMap;

use async_trait::async_trait;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::clients::dtos::{ExternalDish, ExternalDishIngredient, SearchQuery, SearchResult};
use crate::clients::error::ExternalClientError;
use crate::clients::recipe::RecipeProvider;

pub struct TheMealDbClient {
    http: Client,
    base_url: String,
}

impl TheMealDbClient {
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
        if qty_str.contains('/') {
            if let Some(dec) = parse_fraction(qty_str) {
                let unit = if unit_str.is_empty() {
                    "serving".to_string()
                } else {
                    unit_str.to_string()
                };
                return (dec, unit);
            }
        }

        // Sub-case: plain number like "1" or "250"
        if let Ok(qty) = qty_str.parse::<f64>() {
            if let Ok(d) = Decimal::try_from(qty) {
                let unit = if unit_str.is_empty() {
                    "serving".to_string()
                } else {
                    unit_str.to_string()
                };
                return (d, unit);
            }
        }
    }

    // Case: no space — try "250g" pattern (digits/dot then letters)
    let unit_start = s
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(s.len());
    if unit_start > 0 {
        let qty_str = &s[..unit_start];
        let unit = s[unit_start..].trim();
        if let Ok(qty) = qty_str.parse::<f64>() {
            if let Ok(d) = Decimal::try_from(qty) {
                let unit = if unit.is_empty() {
                    "serving".to_string()
                } else {
                    unit.to_string()
                };
                return (d, unit);
            }
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

// ---------------------------------------------------------------------------
// RecipeProvider impl
// ---------------------------------------------------------------------------

#[async_trait]
impl RecipeProvider for TheMealDbClient {
    fn source_name(&self) -> &str {
        "themealdb"
    }

    async fn search_dishes(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalClientError> {
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
            return Err(ExternalClientError::Unauthorized);
        }
        if status.as_u16() == 429 {
            let retry_after_secs = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok());
            return Err(ExternalClientError::RateLimited { retry_after_secs });
        }
        if !status.is_success() {
            return Err(ExternalClientError::HttpError(format!(
                "HTTP {}",
                status.as_u16()
            )));
        }

        let body: MdbSearchResponse = resp
            .json()
            .await
            .map_err(|e| ExternalClientError::ResponseParseError(e.to_string()))?;

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

    async fn get_dish_by_id(
        &self,
        external_id: &str,
    ) -> Result<Option<ExternalDish>, ExternalClientError> {
        let url = format!("{}/lookup.php", self.base_url);
        let resp = self
            .http
            .get(&url)
            .query(&[("i", external_id)])
            .send()
            .await?;

        let status = resp.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(ExternalClientError::Unauthorized);
        }
        if status.as_u16() == 429 {
            let retry_after_secs = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok());
            return Err(ExternalClientError::RateLimited { retry_after_secs });
        }
        if !status.is_success() {
            return Err(ExternalClientError::HttpError(format!(
                "HTTP {}",
                status.as_u16()
            )));
        }

        let body: MdbSearchResponse = resp
            .json()
            .await
            .map_err(|e| ExternalClientError::ResponseParseError(e.to_string()))?;

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
}
