//! Fixture-backed `NutritionProvider` for e2e tests.
//!
//! Reads a captured `HashMap<query, Vec<SearchResult>>` (search.json) and
//! `HashMap<external_id, ExternalIngredient>` (lookup.json) from disk instead
//! of issuing a network request. Only compiled in debug builds so release
//! binaries cannot accidentally serve fixtures.
//!
//! `search.json` is keyed by lowercased query term so the fixture mimics a
//! real provider's per-query behavior — searches for terms not present in
//! the fixture return empty results, and the catalog seeder (which iterates
//! `plnd_seed::INGREDIENT_TERMS`) only sees what live would have returned for
//! those specific terms.

#![cfg(debug_assertions)]

use std::collections::HashMap;
use std::path::PathBuf;

use async_trait::async_trait;

use crate::providers::dtos::{ExternalIngredient, SearchQuery, SearchResult};
use crate::providers::error::ExternalProviderError;
use crate::providers::nutrition::NutritionProvider;

#[derive(Debug)]
pub struct FixtureNutritionProvider {
    source: String,
    search_path: PathBuf,
    lookup_path: PathBuf,
    canonical: bool,
}

impl FixtureNutritionProvider {
    pub fn new(
        source: impl Into<String>,
        search_path: PathBuf,
        lookup_path: PathBuf,
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
            source: source.into(),
            search_path,
            lookup_path,
            canonical: false,
        })
    }

    /// Mark this fixture as a canonical-name source (mirrors the real provider
    /// it stands in for). Defaults to `false`.
    pub fn canonical(mut self, canonical: bool) -> Self {
        self.canonical = canonical;
        self
    }
}

#[async_trait]
impl NutritionProvider for FixtureNutritionProvider {
    fn source_name(&self) -> &str {
        &self.source
    }

    fn is_canonical_source(&self) -> bool {
        self.canonical
    }

    #[tracing::instrument(
        name = "provider::nutrition_fixture::search_ingredients",
        skip(self),
        fields(provider = "nutrition_fixture", source = %self.source)
    )]
    async fn search_ingredients(
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
        name = "provider::nutrition_fixture::get_ingredient_by_id",
        skip(self),
        fields(provider = "nutrition_fixture", source = %self.source, external_id = %external_id)
    )]
    async fn get_ingredient_by_id(
        &self,
        external_id: &str,
    ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
        let bytes = std::fs::read(&self.lookup_path).map_err(|e| {
            ExternalProviderError::ConfigurationError(format!(
                "failed to read fixture {}: {e}",
                self.lookup_path.display()
            ))
        })?;
        let lookup: HashMap<String, ExternalIngredient> = serde_json::from_slice(&bytes)
            .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string()))?;
        Ok(lookup.get(external_id).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEARCH_JSON: &str = r#"{
        "apple": [
            {"external_id": "1750340", "name": "APPLE, RAW", "description": "Fruits and Fruit Juices", "thumbnail_url": null}
        ]
    }"#;

    const LOOKUP_JSON: &str = r#"{
        "1750340": {
            "external_id": "1750340",
            "name": "APPLE, RAW",
            "serving_size_g": "100",
            "nutrition": {
                "calories_kcal": 52.0,
                "protein_g": 0.3,
                "carbohydrates_g": 13.8,
                "fat_g": 0.2,
                "fiber_g": null,
                "sugar_g": null,
                "sodium_mg": null,
                "potassium_mg": null,
                "calcium_mg": null,
                "iron_mg": null,
                "vitamin_c_mg": null,
                "vitamin_d_iu": null,
                "saturated_fat_g": null,
                "cholesterol_mg": null
            },
            "allergens": [],
            "occasion_tags": []
        }
    }"#;

    fn fixture_provider() -> (tempfile::TempDir, FixtureNutritionProvider) {
        let tmp = tempfile::tempdir().unwrap();
        let search_path = tmp.path().join("search.json");
        let lookup_path = tmp.path().join("lookup.json");
        std::fs::write(&search_path, SEARCH_JSON).unwrap();
        std::fs::write(&lookup_path, LOOKUP_JSON).unwrap();
        let provider = FixtureNutritionProvider::new("usda_fdc", search_path, lookup_path).unwrap();
        (tmp, provider)
    }

    #[tokio::test]
    async fn search_ingredients_reads_fixture_from_file() {
        let (_tmp, provider) = fixture_provider();
        let results = provider
            .search_ingredients(&SearchQuery::new("apple"))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].external_id, "1750340");
        assert_eq!(results[0].name, "APPLE, RAW");
        assert_eq!(
            results[0].description.as_deref(),
            Some("Fruits and Fruit Juices")
        );
    }

    #[tokio::test]
    async fn search_for_unknown_query_returns_empty() {
        let (_tmp, provider) = fixture_provider();
        let results = provider
            .search_ingredients(&SearchQuery::new("not-in-fixture"))
            .await
            .unwrap();

        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn search_lowercases_query_for_lookup() {
        let (_tmp, provider) = fixture_provider();
        let results = provider
            .search_ingredients(&SearchQuery::new("APPLE"))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].external_id, "1750340");
    }

    #[tokio::test]
    async fn get_ingredient_by_id_returns_lookup_entry() {
        let (_tmp, provider) = fixture_provider();
        let result = provider.get_ingredient_by_id("1750340").await.unwrap();
        let ingredient = result.expect("fixture contains this id");
        assert_eq!(ingredient.external_id, "1750340");
        assert_eq!(ingredient.name, "APPLE, RAW");
        let nutrition = ingredient.nutrition.expect("nutrition present in fixture");
        assert_eq!(nutrition.calories_kcal, Some(52.0));
    }

    #[tokio::test]
    async fn get_ingredient_by_id_returns_none_for_unknown_id() {
        let (_tmp, provider) = fixture_provider();
        let result = provider
            .get_ingredient_by_id("not-in-lookup")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn new_returns_error_when_search_path_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let lookup_path = tmp.path().join("lookup.json");
        std::fs::write(&lookup_path, "{}").unwrap();

        let err = FixtureNutritionProvider::new(
            "usda_fdc",
            PathBuf::from("/nonexistent/search.json"),
            lookup_path,
        )
        .unwrap_err();
        assert!(matches!(err, ExternalProviderError::ConfigurationError(_)));
    }

    #[tokio::test]
    async fn new_returns_error_when_lookup_path_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let search_path = tmp.path().join("search.json");
        std::fs::write(&search_path, "[]").unwrap();

        let err = FixtureNutritionProvider::new(
            "usda_fdc",
            search_path,
            PathBuf::from("/nonexistent/lookup.json"),
        )
        .unwrap_err();
        assert!(matches!(err, ExternalProviderError::ConfigurationError(_)));
    }

    #[tokio::test]
    async fn search_returns_parse_error_on_invalid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let search_path = tmp.path().join("search.json");
        let lookup_path = tmp.path().join("lookup.json");
        std::fs::write(&search_path, "not json").unwrap();
        std::fs::write(&lookup_path, "{}").unwrap();

        let provider = FixtureNutritionProvider::new("usda_fdc", search_path, lookup_path).unwrap();
        let err = provider
            .search_ingredients(&SearchQuery::new("apple"))
            .await
            .unwrap_err();
        assert!(matches!(err, ExternalProviderError::ResponseParseError(_)));
    }

    #[tokio::test]
    async fn get_ingredient_by_id_returns_parse_error_on_invalid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let search_path = tmp.path().join("search.json");
        let lookup_path = tmp.path().join("lookup.json");
        std::fs::write(&search_path, "[]").unwrap();
        std::fs::write(&lookup_path, "not json").unwrap();

        let provider = FixtureNutritionProvider::new("usda_fdc", search_path, lookup_path).unwrap();
        let err = provider.get_ingredient_by_id("any").await.unwrap_err();
        assert!(matches!(err, ExternalProviderError::ResponseParseError(_)));
    }

    #[test]
    fn canonical_flag_defaults_false_and_is_set_by_builder() {
        let (_tmp, provider) = fixture_provider();
        assert!(
            !provider.is_canonical_source(),
            "fixture defaults to non-canonical"
        );
        assert!(
            provider.canonical(true).is_canonical_source(),
            "builder marks the fixture canonical"
        );
    }
}
