//! Fixture-backed `NutritionProvider` for e2e tests.
//!
//! Reads a captured `Vec<SearchResult>` from disk instead of issuing a network
//! request. Only compiled in debug builds so release binaries cannot accidentally
//! serve fixtures.

#![cfg(debug_assertions)]

use std::path::PathBuf;

use async_trait::async_trait;

use crate::providers::dtos::{ExternalIngredient, SearchQuery, SearchResult};
use crate::providers::error::ExternalProviderError;
use crate::providers::nutrition::NutritionProvider;

#[derive(Debug)]
pub struct FixtureNutritionProvider {
    source: String,
    search_path: PathBuf,
}

impl FixtureNutritionProvider {
    pub fn new(
        source: impl Into<String>,
        search_path: PathBuf,
    ) -> Result<Self, ExternalProviderError> {
        if !search_path.is_file() {
            return Err(ExternalProviderError::ConfigurationError(format!(
                "fixture search file not found: {}",
                search_path.display()
            )));
        }
        Ok(Self {
            source: source.into(),
            search_path,
        })
    }
}

#[async_trait]
impl NutritionProvider for FixtureNutritionProvider {
    fn source_name(&self) -> &str {
        &self.source
    }

    #[tracing::instrument(
        name = "provider::nutrition_fixture::search_ingredients",
        skip(self),
        fields(provider = "nutrition_fixture", source = %self.source)
    )]
    async fn search_ingredients(
        &self,
        _query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalProviderError> {
        let bytes = std::fs::read(&self.search_path).map_err(|e| {
            ExternalProviderError::ConfigurationError(format!(
                "failed to read fixture {}: {e}",
                self.search_path.display()
            ))
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string()))
    }

    #[tracing::instrument(
        name = "provider::nutrition_fixture::get_ingredient_by_id",
        skip(self),
        fields(provider = "nutrition_fixture", source = %self.source, external_id = %_external_id)
    )]
    async fn get_ingredient_by_id(
        &self,
        _external_id: &str,
    ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEARCH_JSON: &str = r#"[
        {"external_id": "1750340", "name": "APPLE, RAW", "description": "Fruits and Fruit Juices", "thumbnail_url": null}
    ]"#;

    fn fixture_provider() -> (tempfile::TempDir, FixtureNutritionProvider) {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("search.json");
        std::fs::write(&path, SEARCH_JSON).unwrap();
        let provider = FixtureNutritionProvider::new("usda_fdc", path).unwrap();
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
    async fn search_ignores_query_returns_all_fixture_results() {
        let (_tmp, provider) = fixture_provider();
        let results = provider
            .search_ingredients(&SearchQuery::new("completely different query"))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
    }

    #[tokio::test]
    async fn get_ingredient_by_id_returns_none() {
        let (_tmp, provider) = fixture_provider();
        let result = provider.get_ingredient_by_id("1750340").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn new_returns_error_when_path_missing() {
        let err =
            FixtureNutritionProvider::new("usda_fdc", PathBuf::from("/nonexistent/search.json"))
                .unwrap_err();
        assert!(matches!(err, ExternalProviderError::ConfigurationError(_)));
    }

    #[tokio::test]
    async fn search_returns_parse_error_on_invalid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("search.json");
        std::fs::write(&path, "not json").unwrap();

        let provider = FixtureNutritionProvider::new("usda_fdc", path).unwrap();
        let err = provider
            .search_ingredients(&SearchQuery::new("test"))
            .await
            .unwrap_err();
        assert!(matches!(err, ExternalProviderError::ResponseParseError(_)));
    }
}
