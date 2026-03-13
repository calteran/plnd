use async_trait::async_trait;
use futures::StreamExt;
use plnd_data::cache::{make_cache_key, SearchCache};
use plnd_data::clients::dtos::{ExternalIngredient, SearchQuery, SearchResult};
use plnd_data::clients::error::ExternalClientError;
use plnd_data::clients::nutrition::NutritionProvider;
use plnd_data::search::{ProviderSearchEvent, ProviderSearchService};
use std::sync::Arc;

// --- Offline tests ---

#[test]
fn test_make_cache_key_normalizes_query() {
    let query = SearchQuery {
        query: "  Chicken BREAST  ".to_string(),
        limit: 20,
        exclude_allergens: vec![],
    };
    let key = make_cache_key("ingredient", "test_provider", &query);
    assert!(key.contains("chicken breast"), "key was: {key}");
}

#[test]
fn test_make_cache_key_sorts_allergens() {
    let q1 = SearchQuery {
        query: "pasta".to_string(),
        limit: 10,
        exclude_allergens: vec!["gluten".to_string(), "dairy".to_string()],
    };
    let q2 = SearchQuery {
        query: "pasta".to_string(),
        limit: 10,
        exclude_allergens: vec!["dairy".to_string(), "gluten".to_string()],
    };
    assert_eq!(
        make_cache_key("ingredient", "p", &q1),
        make_cache_key("ingredient", "p", &q2),
    );
}

#[test]
fn test_make_cache_key_entity_type_differentiates() {
    let q = SearchQuery {
        query: "chicken".to_string(),
        limit: 20,
        exclude_allergens: vec![],
    };
    assert_ne!(
        make_cache_key("ingredient", "p", &q),
        make_cache_key("dish", "p", &q),
    );
}

#[test]
fn test_search_params_default_limit_is_20() {
    let q = SearchQuery::new("chicken");
    assert_eq!(q.limit, 20);
}

#[test]
fn test_provider_search_event_results_serializes() {
    let ev = ProviderSearchEvent::Results {
        source: "test".to_string(),
        results: vec![],
        from_cache: false,
    };
    let json = serde_json::to_string(&ev).unwrap();
    assert!(json.contains("results"));
}

#[test]
fn test_provider_search_event_done_serializes() {
    let ev = ProviderSearchEvent::Done {
        providers_queried: vec!["a".to_string()],
        providers_from_cache: vec![],
    };
    let json = serde_json::to_string(&ev).unwrap();
    assert!(json.contains("done") || json.contains("providers_queried"));
}

// --- Mock provider ---

struct FixedNutritionProvider {
    source: String,
    results: Vec<SearchResult>,
    should_error: bool,
}

#[async_trait]
impl NutritionProvider for FixedNutritionProvider {
    fn source_name(&self) -> &str {
        &self.source
    }

    async fn search_ingredients(
        &self,
        _query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalClientError> {
        if self.should_error {
            Err(ExternalClientError::HttpError("test error".to_string()))
        } else {
            Ok(self.results.clone())
        }
    }

    async fn get_ingredient_by_id(
        &self,
        _id: &str,
    ) -> Result<Option<ExternalIngredient>, ExternalClientError> {
        Ok(None)
    }
}

fn make_service_with_provider(provider: FixedNutritionProvider) -> ProviderSearchService {
    let cache = SearchCache::new(1);
    ProviderSearchService::new(vec![Arc::new(provider)], vec![], vec![], cache)
}

#[tokio::test]
async fn test_cache_miss_populates_cache() {
    let svc = make_service_with_provider(FixedNutritionProvider {
        source: "fixed".to_string(),
        results: vec![SearchResult {
            external_id: "1".to_string(),
            name: "Chicken".to_string(),
            description: None,
            thumbnail_url: None,
        }],
        should_error: false,
    });

    let q = SearchQuery::new("chicken");
    let events: Vec<_> = svc.search_ingredients(q).collect().await;
    let has_results = events
        .iter()
        .any(|e| matches!(e, ProviderSearchEvent::Results { .. }));
    assert!(has_results);
}

#[tokio::test]
async fn test_stream_ends_with_done_event() {
    let svc = make_service_with_provider(FixedNutritionProvider {
        source: "fixed".to_string(),
        results: vec![],
        should_error: false,
    });

    let q = SearchQuery::new("pasta");
    let events: Vec<_> = svc.search_ingredients(q).collect().await;
    let last = events.last().unwrap();
    assert!(matches!(last, ProviderSearchEvent::Done { .. }));
}

#[tokio::test]
async fn test_provider_error_does_not_stop_stream() {
    let svc = make_service_with_provider(FixedNutritionProvider {
        source: "fixed".to_string(),
        results: vec![],
        should_error: true,
    });

    let q = SearchQuery::new("pasta");
    let events: Vec<_> = svc.search_ingredients(q).collect().await;
    // Stream should complete (Done event present) even when provider errors
    let has_done = events
        .iter()
        .any(|e| matches!(e, ProviderSearchEvent::Done { .. }));
    assert!(has_done);
}

#[tokio::test]
async fn test_cache_hit_served_without_spawning() {
    let cache = SearchCache::new(1);
    let q = SearchQuery::new("chicken");
    let key = make_cache_key("ingredient", "fixed", &q);
    let cached_result = vec![SearchResult {
        external_id: "cached".to_string(),
        name: "Cached Chicken".to_string(),
        description: None,
        thumbnail_url: None,
    }];
    cache.insert(key, cached_result.clone()).await;

    let svc = ProviderSearchService::new(
        vec![Arc::new(FixedNutritionProvider {
            source: "fixed".to_string(),
            results: vec![], // Would be empty if actually called
            should_error: false,
        })],
        vec![],
        vec![],
        cache,
    );

    let events: Vec<_> = svc.search_ingredients(q).collect().await;
    let cache_hits: Vec<_> = events
        .iter()
        .filter(|e| {
            matches!(
                e,
                ProviderSearchEvent::Results {
                    from_cache: true,
                    ..
                }
            )
        })
        .collect();
    assert_eq!(cache_hits.len(), 1);
}
