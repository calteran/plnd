use async_trait::async_trait;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::providers::dtos::{ExternalIngredient, NutritionFacts, SearchQuery, SearchResult};
use crate::providers::error::ExternalProviderError;
use crate::providers::nutrition::NutritionProvider;

pub struct UsdaFdcProvider {
    http: Client,
    api_key: String,
}

impl UsdaFdcProvider {
    pub fn new(api_key: &str) -> Self {
        Self {
            http: super::build_http_client(),
            api_key: api_key.to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// Internal response types — serde-only, not part of the public API
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct FdcSearchResponse {
    foods: Vec<FdcSearchFood>,
}

#[derive(Deserialize)]
struct FdcSearchFood {
    #[serde(rename = "fdcId")]
    fdc_id: i64,
    description: String,
    #[serde(rename = "foodCategory")]
    food_category: Option<String>,
}

#[derive(Deserialize)]
struct FdcDetailFood {
    #[serde(rename = "fdcId")]
    fdc_id: i64,
    description: String,
    #[serde(rename = "foodCategory")]
    food_category: Option<FdcFoodCategory>,
    #[serde(rename = "foodPortions")]
    food_portions: Option<Vec<FdcFoodPortion>>,
    #[serde(rename = "foodNutrients")]
    food_nutrients: Vec<FdcDetailNutrient>,
}

#[derive(Deserialize)]
struct FdcFoodCategory {
    description: String,
}

#[derive(Deserialize)]
struct FdcFoodPortion {
    #[serde(rename = "gramWeight")]
    gram_weight: f64,
}

#[derive(Deserialize)]
struct FdcDetailNutrient {
    nutrient: FdcNutrientInfo,
    // Category-header rows (e.g. "Proximates") have no amount field.
    amount: Option<f64>,
}

#[derive(Deserialize)]
struct FdcNutrientInfo {
    id: i32,
    // name and unitName are ignored — we use the ID for reliable mapping
}

// ---------------------------------------------------------------------------
// Nutrient ID → NutritionFacts field mapping
// All USDA values are in correct units (mg for minerals, g for macros, kcal, IU for D)
// ---------------------------------------------------------------------------

fn apply_nutrient(facts: &mut NutritionFacts, nutrient_id: i32, amount: f64) {
    match nutrient_id {
        1008 => facts.calories_kcal = Some(amount),
        1003 => facts.protein_g = Some(amount),
        1005 => facts.carbohydrates_g = Some(amount),
        1004 => facts.fat_g = Some(amount),
        1079 => facts.fiber_g = Some(amount),
        2000 => facts.sugar_g = Some(amount),
        1093 => facts.sodium_mg = Some(amount),
        1092 => facts.potassium_mg = Some(amount),
        1087 => facts.calcium_mg = Some(amount),
        1089 => facts.iron_mg = Some(amount),
        1162 => facts.vitamin_c_mg = Some(amount),
        1110 => facts.vitamin_d_iu = Some(amount),
        1258 => facts.saturated_fat_g = Some(amount),
        1253 => facts.cholesterol_mg = Some(amount),
        _ => {} // silently ignore unknown nutrient IDs
    }
}

fn build_nutrition_from_detail(nutrients: &[FdcDetailNutrient]) -> NutritionFacts {
    let mut facts = NutritionFacts::default();
    for n in nutrients {
        if let Some(amount) = n.amount {
            apply_nutrient(&mut facts, n.nutrient.id, amount);
        }
    }
    facts
}

// ---------------------------------------------------------------------------
// NutritionProvider impl
// ---------------------------------------------------------------------------

#[async_trait]
impl NutritionProvider for UsdaFdcProvider {
    fn source_name(&self) -> &str {
        "usda_fdc"
    }

    #[tracing::instrument(
        name = "provider::usda_fdc::search_ingredients",
        skip(self),
        fields(provider = "usda_fdc")
    )]
    async fn search_ingredients(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalProviderError> {
        if self.api_key.is_empty() {
            return Err(ExternalProviderError::ConfigurationError(
                "USDA FDC API key is not configured".to_string(),
            ));
        }

        let resp = self
            .http
            .get("https://api.nal.usda.gov/fdc/v1/foods/search")
            .query(&[
                ("query", query.query.as_str()),
                ("pageSize", &query.limit.to_string()),
                ("api_key", self.api_key.as_str()),
            ])
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

        let body: FdcSearchResponse = resp
            .json()
            .await
            .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string()))?;

        let results = body
            .foods
            .into_iter()
            .map(|f| SearchResult {
                external_id: f.fdc_id.to_string(),
                name: f.description,
                description: f.food_category,
                thumbnail_url: None,
            })
            .collect();

        Ok(results)
    }

    #[tracing::instrument(name = "provider::usda_fdc::get_ingredient_by_id", skip(self), fields(provider = "usda_fdc", external_id = %external_id))]
    async fn get_ingredient_by_id(
        &self,
        external_id: &str,
    ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
        if self.api_key.is_empty() {
            return Err(ExternalProviderError::ConfigurationError(
                "USDA FDC API key is not configured".to_string(),
            ));
        }

        let url = format!("https://api.nal.usda.gov/fdc/v1/food/{}", external_id);
        let resp = self
            .http
            .get(&url)
            .query(&[("api_key", self.api_key.as_str())])
            .send()
            .await?;

        let status = resp.status();
        if status.as_u16() == 404 {
            return Ok(None);
        }
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

        let food: FdcDetailFood = resp
            .json()
            .await
            .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string()))?;

        let serving_size_g = food
            .food_portions
            .as_deref()
            .and_then(|p| p.first())
            .and_then(|p| Decimal::try_from(p.gram_weight).ok())
            .unwrap_or(Decimal::from(100u32));

        let nutrition = build_nutrition_from_detail(&food.food_nutrients);
        let category = food.food_category.map(|c| c.description);

        Ok(Some(ExternalIngredient {
            external_id: food.fdc_id.to_string(),
            name: food.description,
            serving_size_g: Some(serving_size_g),
            nutrition: Some(nutrition),
            allergens: vec![], // USDA FDC does not provide allergen data
            occasion_tags: category.into_iter().collect(),
        }))
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::dtos::SearchQuery;
    use crate::providers::error::ExternalProviderError;

    #[test]
    fn test_apply_nutrient_maps_all_known_ids() {
        let mut facts = NutritionFacts::default();
        apply_nutrient(&mut facts, 1008, 95.0);
        apply_nutrient(&mut facts, 1003, 0.5);
        apply_nutrient(&mut facts, 1005, 25.1);
        apply_nutrient(&mut facts, 1004, 0.3);
        apply_nutrient(&mut facts, 1079, 4.4);
        apply_nutrient(&mut facts, 2000, 10.0);
        apply_nutrient(&mut facts, 1093, 1.0);
        apply_nutrient(&mut facts, 1092, 107.0);
        apply_nutrient(&mut facts, 1087, 6.0);
        apply_nutrient(&mut facts, 1089, 0.1);
        apply_nutrient(&mut facts, 1162, 4.7);
        apply_nutrient(&mut facts, 1110, 0.0);
        apply_nutrient(&mut facts, 1258, 0.05);
        apply_nutrient(&mut facts, 1253, 0.0);

        assert_eq!(facts.calories_kcal, Some(95.0));
        assert_eq!(facts.protein_g, Some(0.5));
        assert_eq!(facts.carbohydrates_g, Some(25.1));
        assert_eq!(facts.fat_g, Some(0.3));
        assert_eq!(facts.fiber_g, Some(4.4));
        assert_eq!(facts.sugar_g, Some(10.0));
        assert_eq!(facts.sodium_mg, Some(1.0));
        assert_eq!(facts.potassium_mg, Some(107.0));
        assert_eq!(facts.calcium_mg, Some(6.0));
        assert_eq!(facts.iron_mg, Some(0.1));
        assert_eq!(facts.vitamin_c_mg, Some(4.7));
        assert_eq!(facts.vitamin_d_iu, Some(0.0));
        assert_eq!(facts.saturated_fat_g, Some(0.05));
        assert_eq!(facts.cholesterol_mg, Some(0.0));
    }

    #[test]
    fn test_apply_nutrient_unknown_id_silently_ignored() {
        let mut facts = NutritionFacts::default();
        apply_nutrient(&mut facts, 9999, 42.0);
        // All fields should remain None
        assert_eq!(facts.calories_kcal, None);
        assert_eq!(facts.protein_g, None);
    }

    #[test]
    fn test_build_nutrition_from_14_element_list() {
        let nutrients = vec![
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1008 },
                amount: Some(52.0),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1003 },
                amount: Some(0.26),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1005 },
                amount: Some(13.81),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1004 },
                amount: Some(0.17),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1079 },
                amount: Some(2.4),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 2000 },
                amount: Some(10.39),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1093 },
                amount: Some(1.0),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1092 },
                amount: Some(107.0),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1087 },
                amount: Some(6.0),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1089 },
                amount: Some(0.12),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1162 },
                amount: Some(4.6),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1110 },
                amount: Some(0.0),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1258 },
                amount: Some(0.028),
            },
            FdcDetailNutrient {
                nutrient: FdcNutrientInfo { id: 1253 },
                amount: Some(0.0),
            },
        ];
        let facts = build_nutrition_from_detail(&nutrients);
        assert_eq!(facts.calories_kcal, Some(52.0));
        assert_eq!(facts.carbohydrates_g, Some(13.81));
        assert_eq!(facts.potassium_mg, Some(107.0));
    }

    #[test]
    fn test_fdc_detail_food_json_round_trip() {
        let json = r#"{
            "fdcId": 1750340,
            "description": "APPLE, RAW",
            "foodCategory": { "description": "Fruits and Fruit Juices" },
            "foodPortions": [{ "gramWeight": 182.0 }],
            "foodNutrients": [
                { "nutrient": { "id": 1008 }, "amount": 95.0 }
            ]
        }"#;
        let food: FdcDetailFood = serde_json::from_str(json).expect("deserialize");
        assert_eq!(food.fdc_id, 1750340);
        assert_eq!(food.description, "APPLE, RAW");
        assert_eq!(
            food.food_category.unwrap().description,
            "Fruits and Fruit Juices"
        );
        assert!((food.food_portions.unwrap()[0].gram_weight - 182.0).abs() < 0.001);
        assert_eq!(food.food_nutrients[0].nutrient.id, 1008);
        assert_eq!(food.food_nutrients[0].amount, Some(95.0));
    }

    #[test]
    fn test_header_nutrient_without_amount_is_skipped() {
        // The USDA API includes category-header entries (e.g. "Proximates") with no
        // amount field. Verify they deserialize cleanly and contribute nothing to facts.
        let json = r#"{
            "fdcId": 173945,
            "description": "Bananas, dehydrated",
            "foodNutrients": [
                { "nutrient": { "id": 2045 }, "type": "FoodNutrient" },
                { "nutrient": { "id": 1008 }, "amount": 346.0, "type": "FoodNutrient" }
            ]
        }"#;
        let food: FdcDetailFood =
            serde_json::from_str(json).expect("should not fail on missing amount");
        let facts = build_nutrition_from_detail(&food.food_nutrients);
        assert_eq!(facts.calories_kcal, Some(346.0));
    }

    #[tokio::test]
    async fn test_empty_api_key_returns_configuration_error() {
        let client = UsdaFdcProvider::new("");
        let query = SearchQuery::new("apple");
        let result = client.search_ingredients(&query).await;
        assert!(
            matches!(result, Err(ExternalProviderError::ConfigurationError(_))),
            "expected ConfigurationError, got: {:?}",
            result
        );
    }
}
