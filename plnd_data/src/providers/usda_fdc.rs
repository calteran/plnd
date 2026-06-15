use async_trait::async_trait;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::providers::dtos::{ExternalIngredient, NutritionFacts, SearchQuery, SearchResult};
use crate::providers::error::ExternalProviderError;
use crate::providers::nutrition::NutritionProvider;

/// USDA FDC data types. `Foundation` + `SR Legacy` carry clean generic names;
/// everything else (including unknown/renamed types via `#[serde(other)]`) is
/// non-canonical, so the client-side filter fails closed if USDA renames a type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum FdcDataType {
    Foundation,
    #[serde(rename = "SR Legacy")]
    SrLegacy,
    Branded,
    #[serde(rename = "Survey (FNDDS)")]
    SurveyFndds,
    #[serde(other)]
    Unknown,
}

impl FdcDataType {
    fn is_canonical(self) -> bool {
        matches!(self, FdcDataType::Foundation | FdcDataType::SrLegacy)
    }
}

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
    #[serde(rename = "dataType")]
    data_type: Option<FdcDataType>,
}

#[derive(Deserialize)]
struct FdcDetailFood {
    #[serde(rename = "fdcId")]
    fdc_id: i64,
    description: String,
    #[serde(rename = "foodPortions")]
    food_portions: Option<Vec<FdcFoodPortion>>,
    #[serde(rename = "foodNutrients")]
    food_nutrients: Vec<FdcDetailNutrient>,
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

/// Map a parsed USDA food (detail-endpoint or bulk-dataset shape) to an
/// `ExternalIngredient`. Shared by the live `get_ingredient_by_id` path and the
/// offline bulk-corpus parser so the two cannot drift.
fn detail_to_ingredient(food: FdcDetailFood) -> ExternalIngredient {
    let serving_size_g = food
        .food_portions
        .as_deref()
        .and_then(|p| p.first())
        .and_then(|p| Decimal::try_from(p.gram_weight).ok())
        .unwrap_or(Decimal::from(100u32));
    let nutrition = build_nutrition_from_detail(&food.food_nutrients);
    ExternalIngredient {
        external_id: food.fdc_id.to_string(),
        name: food.description,
        serving_size_g: Some(serving_size_g),
        nutrition: Some(nutrition),
        allergens: vec![], // USDA FDC does not provide allergen data
    }
}

/// Bulk USDA dataset envelope. Foundation files wrap foods in `FoundationFoods`,
/// SR Legacy in `SRLegacyFoods`; both share the per-food `FdcDetailFood` shape.
/// Only those two keys are accepted — a stray top-level `foods` object does not parse.
///
/// Elements are `Option<FdcDetailFood>` because USDA's Foundation file embeds
/// `null` holes in the array (32 of 395 in the 2026-04 release); those are
/// dropped rather than failing the whole parse.
#[derive(Deserialize)]
struct FdcBulkDataset {
    #[serde(rename = "FoundationFoods", alias = "SRLegacyFoods")]
    foods: Vec<Option<FdcDetailFood>>,
}

/// Parse a USDA bulk dataset JSON (Foundation or SR Legacy) into ingredients.
/// Used by the `build_usda_corpus` dev tool; not on the request path.
pub fn parse_bulk_dataset(json: &str) -> Result<Vec<ExternalIngredient>, serde_json::Error> {
    let ds: FdcBulkDataset = serde_json::from_str(json)?;
    Ok(ds
        .foods
        .into_iter()
        .flatten()
        .map(detail_to_ingredient)
        .collect())
}

// ---------------------------------------------------------------------------
// NutritionProvider impl
// ---------------------------------------------------------------------------

#[async_trait]
impl NutritionProvider for UsdaFdcProvider {
    fn source_name(&self) -> &str {
        "usda_fdc"
    }

    fn is_canonical_source(&self) -> bool {
        true
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
                ("dataType", "Foundation"),
                ("dataType", "SR Legacy"),
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
            .filter(|f| f.data_type.map(FdcDataType::is_canonical).unwrap_or(false))
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

        Ok(Some(detail_to_ingredient(food)))
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

    #[test]
    fn usda_is_a_canonical_source() {
        assert!(
            UsdaFdcProvider::new("key").is_canonical_source(),
            "USDA Foundation/SR Legacy supplies clean canonical names"
        );
    }

    #[test]
    fn fdc_data_type_classifies_canonical_and_fails_closed() {
        assert!(FdcDataType::Foundation.is_canonical());
        assert!(FdcDataType::SrLegacy.is_canonical());
        assert!(!FdcDataType::Branded.is_canonical());
        assert!(!FdcDataType::SurveyFndds.is_canonical());
        // Unknown/renamed types fail closed (non-canonical).
        assert!(!FdcDataType::Unknown.is_canonical());
    }

    #[test]
    fn fdc_data_type_deserializes_wire_strings() {
        let parse = |s: &str| serde_json::from_str::<FdcDataType>(&format!("\"{s}\"")).unwrap();
        assert_eq!(parse("Foundation"), FdcDataType::Foundation);
        assert_eq!(parse("SR Legacy"), FdcDataType::SrLegacy);
        assert_eq!(parse("Branded"), FdcDataType::Branded);
        assert_eq!(parse("Survey (FNDDS)"), FdcDataType::SurveyFndds);
        // A renamed/unknown type maps to Unknown rather than failing to parse.
        assert_eq!(parse("Standard Reference Legacy"), FdcDataType::Unknown);
    }

    #[test]
    fn search_food_deserializes_data_type() {
        let json =
            r#"{ "fdcId": 1, "description": "ALFREDO BROCCOLI ...", "dataType": "Branded" }"#;
        let food: FdcSearchFood = serde_json::from_str(json).expect("deserialize");
        assert_eq!(food.data_type, Some(FdcDataType::Branded));
        assert!(
            !food.data_type.map(|d| d.is_canonical()).unwrap_or(false),
            "branded composite must be classified non-canonical"
        );
    }

    #[test]
    fn parse_bulk_foundation_envelope_maps_food() {
        let json = r#"{
            "FoundationFoods": [
                {
                    "fdcId": 2262072,
                    "description": "Oats, whole grain, rolled",
                    "foodCategory": { "description": "Cereal Grains and Pasta" },
                    "foodPortions": [{ "gramWeight": 40.0 }],
                    "foodNutrients": [
                        { "nutrient": { "id": 1008 }, "amount": 379.0 },
                        { "nutrient": { "id": 1003 }, "amount": 13.2 }
                    ]
                }
            ]
        }"#;
        let foods = parse_bulk_dataset(json).expect("parse");
        assert_eq!(foods.len(), 1);
        assert_eq!(foods[0].external_id, "2262072");
        assert_eq!(foods[0].name, "Oats, whole grain, rolled");
        assert_eq!(
            foods[0].serving_size_g,
            Some(rust_decimal::Decimal::try_from(40.0).unwrap())
        );
        assert_eq!(
            foods[0].nutrition.as_ref().unwrap().calories_kcal,
            Some(379.0)
        );
        // The `foodCategory` in the input is intentionally dropped, not mapped
        // into occasion data — `ExternalIngredient` has no occasion field (#921).
    }

    #[test]
    fn parse_bulk_sr_legacy_envelope_maps_food() {
        let json = r#"{
            "SRLegacyFoods": [
                { "fdcId": 173410, "description": "Milk, whole",
                  "foodNutrients": [ { "nutrient": { "id": 1008 }, "amount": 61.0 } ] }
            ]
        }"#;
        let foods = parse_bulk_dataset(json).expect("parse");
        assert_eq!(foods.len(), 1);
        assert_eq!(foods[0].name, "Milk, whole");
        assert_eq!(
            foods[0].serving_size_g,
            Some(rust_decimal::Decimal::from(100u32))
        );
    }

    #[test]
    fn parse_bulk_dataset_rejects_unknown_envelope() {
        let json = r#"{ "SomethingElse": [] }"#;
        assert!(parse_bulk_dataset(json).is_err());
    }

    #[test]
    fn parse_bulk_dataset_skips_null_array_holes() {
        // USDA's Foundation file embeds `null` entries in the foods array (32 of
        // 395 in the 2026-04 release). They must be dropped, not abort the parse.
        let json = r#"{
            "FoundationFoods": [
                null,
                { "fdcId": 1, "description": "Real food",
                  "foodNutrients": [ { "nutrient": { "id": 1008 }, "amount": 50.0 } ] },
                null
            ]
        }"#;
        let foods = parse_bulk_dataset(json).expect("null holes must not fail the parse");
        assert_eq!(foods.len(), 1);
        assert_eq!(foods[0].name, "Real food");
    }
}
