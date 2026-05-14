//! Fixture-backed `RecipeProvider` for e2e tests.
//!
//! Reads a captured `HashMap<query, Vec<SearchResult>>` (search.json) and
//! `HashMap<external_id, ExternalDish>` (lookup.json) from disk instead of
//! issuing a network request. Only compiled in debug builds so release binaries
//! cannot accidentally serve fixtures.
//!
//! See `nutrition_fixture` for the rationale behind keying search results by
//! query.

#![cfg(debug_assertions)]

use std::collections::HashMap;
use std::path::PathBuf;

use async_trait::async_trait;

use crate::providers::dtos::{ExternalDish, SearchQuery, SearchResult};
use crate::providers::error::ExternalProviderError;
use crate::providers::recipe::RecipeProvider;

#[derive(Debug)]
pub struct FixtureRecipeProvider {
    source: String,
    search_path: PathBuf,
    lookup_path: PathBuf,
}

impl FixtureRecipeProvider {
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
        })
    }
}

#[async_trait]
impl RecipeProvider for FixtureRecipeProvider {
    fn source_name(&self) -> &str {
        &self.source
    }

    #[tracing::instrument(
        name = "provider::recipe_fixture::search_dishes",
        skip(self),
        fields(provider = "recipe_fixture", source = %self.source)
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
        name = "provider::recipe_fixture::get_dish_by_id",
        skip(self),
        fields(provider = "recipe_fixture", source = %self.source, external_id = %external_id)
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
        let lookup: HashMap<String, ExternalDish> = serde_json::from_slice(&bytes)
            .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string()))?;
        Ok(lookup.get(external_id).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEARCH_JSON: &str = r#"{
        "chicken": [
            {"external_id": "52772", "name": "Teriyaki Chicken Casserole", "description": null, "thumbnail_url": null}
        ]
    }"#;

    const LOOKUP_JSON: &str = r#"{
        "52772": {
            "external_id": "52772",
            "name": "Teriyaki Chicken Casserole",
            "instructions": "Preheat oven...",
            "prep_time_minutes": 15,
            "cook_time_minutes": 45,
            "servings": "4",
            "allergens": [],
            "occasion_tags": [],
            "nutrition": null,
            "ingredients": []
        }
    }"#;

    fn fixture_provider() -> (tempfile::TempDir, FixtureRecipeProvider) {
        let tmp = tempfile::tempdir().unwrap();
        let search_path = tmp.path().join("search.json");
        let lookup_path = tmp.path().join("lookup.json");
        std::fs::write(&search_path, SEARCH_JSON).unwrap();
        std::fs::write(&lookup_path, LOOKUP_JSON).unwrap();
        let provider = FixtureRecipeProvider::new("themealdb", search_path, lookup_path).unwrap();
        (tmp, provider)
    }

    #[tokio::test]
    async fn search_dishes_reads_fixture_from_file() {
        let (_tmp, provider) = fixture_provider();
        let results = provider
            .search_dishes(&SearchQuery::new("chicken"))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].external_id, "52772");
        assert_eq!(results[0].name, "Teriyaki Chicken Casserole");
    }

    #[tokio::test]
    async fn search_for_unknown_query_returns_empty() {
        let (_tmp, provider) = fixture_provider();
        let results = provider
            .search_dishes(&SearchQuery::new("not-in-fixture"))
            .await
            .unwrap();

        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn search_lowercases_query_for_lookup() {
        let (_tmp, provider) = fixture_provider();
        let results = provider
            .search_dishes(&SearchQuery::new("CHICKEN"))
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].external_id, "52772");
    }

    #[tokio::test]
    async fn get_dish_by_id_returns_lookup_entry() {
        let (_tmp, provider) = fixture_provider();
        let result = provider.get_dish_by_id("52772").await.unwrap();
        let dish = result.expect("fixture contains this id");
        assert_eq!(dish.external_id, "52772");
        assert_eq!(dish.name, "Teriyaki Chicken Casserole");
        assert_eq!(dish.prep_time_minutes, Some(15));
    }

    #[tokio::test]
    async fn get_dish_by_id_returns_none_for_unknown_id() {
        let (_tmp, provider) = fixture_provider();
        let result = provider.get_dish_by_id("not-in-lookup").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn new_returns_error_when_search_path_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let lookup_path = tmp.path().join("lookup.json");
        std::fs::write(&lookup_path, "{}").unwrap();

        let err = FixtureRecipeProvider::new(
            "themealdb",
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

        let err = FixtureRecipeProvider::new(
            "themealdb",
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

        let provider = FixtureRecipeProvider::new("themealdb", search_path, lookup_path).unwrap();
        let err = provider
            .search_dishes(&SearchQuery::new("chicken"))
            .await
            .unwrap_err();
        assert!(matches!(err, ExternalProviderError::ResponseParseError(_)));
    }

    #[tokio::test]
    async fn get_dish_by_id_returns_parse_error_on_invalid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let search_path = tmp.path().join("search.json");
        let lookup_path = tmp.path().join("lookup.json");
        std::fs::write(&search_path, "[]").unwrap();
        std::fs::write(&lookup_path, "not json").unwrap();

        let provider = FixtureRecipeProvider::new("themealdb", search_path, lookup_path).unwrap();
        let err = provider.get_dish_by_id("any").await.unwrap_err();
        assert!(matches!(err, ExternalProviderError::ResponseParseError(_)));
    }
}
