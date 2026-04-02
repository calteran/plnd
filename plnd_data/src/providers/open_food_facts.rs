use async_trait::async_trait;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::providers::dtos::{ExternalIngredient, NutritionFacts, SearchQuery, SearchResult};
use crate::providers::error::ExternalClientError;
use crate::providers::nutrition::NutritionProvider;

pub struct OpenFoodFactsClient {
    http: Client,
    base_url: String,
    basic_auth: Option<(String, String)>,
}

impl OpenFoodFactsClient {
    pub fn new(base_url: &str, basic_auth: Option<(String, String)>) -> Self {
        Self {
            http: super::build_http_client(),
            base_url: base_url.to_string(),
            basic_auth,
        }
    }
}

impl Default for OpenFoodFactsClient {
    fn default() -> Self {
        // Staging server with public credentials — switch to production URL with no
        // basic auth before launch.
        Self::new(
            "https://world.openfoodfacts.net",
            Some(("off".to_string(), "off".to_string())),
        )
    }
}

// ---------------------------------------------------------------------------
// Internal response types — serde-only, not part of the public API
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct OffSearchResponse {
    products: Vec<OffProduct>,
}

#[derive(Deserialize)]
struct OffDetailResponse {
    status: i32,
    product: Option<OffProduct>,
}

#[derive(Deserialize)]
struct OffProduct {
    code: String,
    product_name: Option<String>,
    allergens_tags: Option<Vec<String>>,
    nutriments: Option<OffNutriments>,
}

#[derive(Deserialize)]
struct OffNutriments {
    #[serde(rename = "energy-kcal_100g")]
    energy_kcal_100g: Option<f64>,
    proteins_100g: Option<f64>,
    carbohydrates_100g: Option<f64>,
    fat_100g: Option<f64>,
    fiber_100g: Option<f64>,
    sugars_100g: Option<f64>,
    /// grams per 100g — multiply by 1000 to get mg
    sodium_100g: Option<f64>,
    /// grams per 100g — multiply by 1000 to get mg
    potassium_100g: Option<f64>,
    /// grams per 100g — multiply by 1000 to get mg
    calcium_100g: Option<f64>,
    /// grams per 100g — multiply by 1000 to get mg
    iron_100g: Option<f64>,
    /// grams per 100g — multiply by 1000 to get mg
    #[serde(rename = "vitamin-c_100g")]
    vitamin_c_100g: Option<f64>,
    #[serde(rename = "saturated-fat_100g")]
    saturated_fat_100g: Option<f64>,
    /// grams per 100g — multiply by 1000 to get mg
    cholesterol_100g: Option<f64>,
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

fn strip_allergen_prefix(tag: &str) -> String {
    tag.strip_prefix("en:").unwrap_or(tag).to_string()
}

fn convert_nutriments(n: &OffNutriments) -> NutritionFacts {
    NutritionFacts {
        calories_kcal: n.energy_kcal_100g,
        protein_g: n.proteins_100g,
        carbohydrates_g: n.carbohydrates_100g,
        fat_g: n.fat_100g,
        fiber_g: n.fiber_100g,
        sugar_g: n.sugars_100g,
        sodium_mg: n.sodium_100g.map(|v| v * 1000.0),
        potassium_mg: n.potassium_100g.map(|v| v * 1000.0),
        calcium_mg: n.calcium_100g.map(|v| v * 1000.0),
        iron_mg: n.iron_100g.map(|v| v * 1000.0),
        vitamin_c_mg: n.vitamin_c_100g.map(|v| v * 1000.0),
        vitamin_d_iu: None, // Open Food Facts does not provide vitamin D in IU
        saturated_fat_g: n.saturated_fat_100g,
        cholesterol_mg: n.cholesterol_100g.map(|v| v * 1000.0),
    }
}

fn product_to_ingredient(p: OffProduct) -> ExternalIngredient {
    let allergens = p
        .allergens_tags
        .unwrap_or_default()
        .iter()
        .map(|t| strip_allergen_prefix(t))
        .collect();
    let nutrition = p.nutriments.map(|n| convert_nutriments(&n));
    ExternalIngredient {
        external_id: p.code,
        name: p.product_name.unwrap_or_default(),
        serving_size_g: Some(Decimal::from(100u32)),
        nutrition,
        allergens,
        occasion_tags: vec![],
    }
}

// ---------------------------------------------------------------------------
// NutritionProvider impl
// ---------------------------------------------------------------------------

#[async_trait]
impl NutritionProvider for OpenFoodFactsClient {
    fn source_name(&self) -> &str {
        "openfoodfacts"
    }

    async fn search_ingredients(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalClientError> {
        let url = format!("{}/cgi/search.pl", self.base_url);
        let req = self.http.get(&url).query(&[
            ("search_terms", query.query.as_str()),
            ("page_size", &query.limit.to_string()),
            ("action", "process"),
            ("json", "1"),
            ("lc", "en"),
            ("cc", "us"),
        ]);
        let req = match &self.basic_auth {
            Some((user, pass)) => req.basic_auth(user, Some(pass)),
            None => req,
        };
        let resp = req.send().await?;

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

        let body: OffSearchResponse = resp
            .json()
            .await
            .map_err(|e| ExternalClientError::ResponseParseError(e.to_string()))?;

        let results = body
            .products
            .into_iter()
            .filter(|p| {
                // Client-side allergen filtering (API has no filter param)
                if query.exclude_allergens.is_empty() {
                    return true;
                }
                let allergens: Vec<String> = p
                    .allergens_tags
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .map(|t| strip_allergen_prefix(t))
                    .collect();
                !query
                    .exclude_allergens
                    .iter()
                    .any(|excl| allergens.contains(excl))
            })
            .map(|p| SearchResult {
                external_id: p.code,
                name: p.product_name.unwrap_or_default(),
                description: None,
                thumbnail_url: None,
            })
            .collect();

        Ok(results)
    }

    async fn get_ingredient_by_id(
        &self,
        external_id: &str,
    ) -> Result<Option<ExternalIngredient>, ExternalClientError> {
        let url = format!("{}/api/v2/product/{}.json", self.base_url, external_id);
        let req = self.http.get(&url).query(&[("lc", "en"), ("cc", "us")]);
        let req = match &self.basic_auth {
            Some((user, pass)) => req.basic_auth(user, Some(pass)),
            None => req,
        };
        let resp = req.send().await?;

        let status = resp.status();
        if status.as_u16() == 404 {
            return Ok(None);
        }
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

        let detail: OffDetailResponse = resp
            .json()
            .await
            .map_err(|e| ExternalClientError::ResponseParseError(e.to_string()))?;

        if detail.status == 0 {
            return Ok(None);
        }

        Ok(detail.product.map(product_to_ingredient))
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_allergen_prefix_with_en_prefix() {
        assert_eq!(strip_allergen_prefix("en:milk"), "milk");
        assert_eq!(strip_allergen_prefix("en:gluten"), "gluten");
    }

    #[test]
    fn test_strip_allergen_prefix_without_prefix() {
        assert_eq!(strip_allergen_prefix("milk"), "milk");
        assert_eq!(strip_allergen_prefix("fr:lait"), "fr:lait");
    }

    #[test]
    fn test_convert_nutriments_g_to_mg_conversions() {
        let n = OffNutriments {
            energy_kcal_100g: Some(100.0),
            proteins_100g: None,
            carbohydrates_100g: None,
            fat_100g: None,
            fiber_100g: None,
            sugars_100g: None,
            sodium_100g: Some(0.5),     // 0.5 g → 500 mg
            potassium_100g: Some(0.3),  // 0.3 g → 300 mg
            calcium_100g: Some(0.1),    // 0.1 g → 100 mg
            iron_100g: Some(0.002),     // 0.002 g → 2 mg
            vitamin_c_100g: Some(0.06), // 0.06 g → 60 mg
            saturated_fat_100g: Some(2.0),
            cholesterol_100g: Some(0.04), // 0.04 g → 40 mg
        };
        let facts = convert_nutriments(&n);

        assert_eq!(facts.calories_kcal, Some(100.0));
        assert!((facts.sodium_mg.unwrap() - 500.0).abs() < 0.001);
        assert!((facts.potassium_mg.unwrap() - 300.0).abs() < 0.001);
        assert!((facts.calcium_mg.unwrap() - 100.0).abs() < 0.001);
        assert!((facts.iron_mg.unwrap() - 2.0).abs() < 0.001);
        assert!((facts.vitamin_c_mg.unwrap() - 60.0).abs() < 0.001);
        assert!((facts.cholesterol_mg.unwrap() - 40.0).abs() < 0.001);
        assert_eq!(facts.vitamin_d_iu, None);
        assert_eq!(facts.saturated_fat_g, Some(2.0));
    }

    #[test]
    fn test_off_nutriments_json_round_trip_with_hyphenated_keys() {
        let json = r#"{
            "energy-kcal_100g": 95.0,
            "proteins_100g": 0.5,
            "carbohydrates_100g": 25.1,
            "fat_100g": 0.3,
            "fiber_100g": 4.4,
            "sugars_100g": 10.0,
            "sodium_100g": 0.001,
            "potassium_100g": 0.107,
            "calcium_100g": 0.006,
            "iron_100g": 0.0001,
            "vitamin-c_100g": 0.0047,
            "saturated-fat_100g": 0.05,
            "cholesterol_100g": 0.0
        }"#;
        let n: OffNutriments = serde_json::from_str(json).expect("deserialize");
        assert_eq!(n.energy_kcal_100g, Some(95.0));
        assert_eq!(n.proteins_100g, Some(0.5));
        assert_eq!(n.saturated_fat_100g, Some(0.05));
        assert_eq!(n.vitamin_c_100g, Some(0.0047));
    }
}
