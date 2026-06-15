use std::sync::Arc;

use futures::stream::Stream;
use serde::Serialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::cache::{SearchCache, make_cache_key};
use crate::providers::dtos::{ExternalDish, ExternalIngredient, SearchQuery, SearchResult};
use crate::providers::exercise::ExerciseProvider;
use crate::providers::nutrition::NutritionProvider;
use crate::providers::recipe::RecipeProvider;

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProviderSearchEvent {
    Results {
        source: String,
        results: Vec<SearchResult>,
        from_cache: bool,
    },
    Error {
        source: String,
        error: String,
    },
    Done {
        providers_queried: Vec<String>,
        providers_from_cache: Vec<String>,
    },
}

/// Minimum share of a query's tokens that must appear in a provider result's
/// name for the match to be trusted. Below this, the top hit is treated as a
/// miss so an invented meal name with no true match doesn't promote a
/// loosely-related recipe under its occasion tags (#903). Deliberately
/// conservative — single-token queries ("chicken") still match supersets
/// ("Chicken Handi") at confidence 1.0.
const MATCH_CONFIDENCE_THRESHOLD: f64 = 0.5;

/// Split a name into a set of lowercased alphanumeric tokens, dropping
/// separators and empties.
fn tokenize(s: &str) -> std::collections::HashSet<String> {
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_lowercase())
        .collect()
}

/// Fraction of the query's tokens that also appear in the candidate's tokens
/// (query-coverage). Order-insensitive and tolerant of extra candidate words,
/// which suits free-text food names. Returns 0.0 for an empty query.
fn name_match_confidence(query: &str, candidate: &str) -> f64 {
    let q = tokenize(query);
    if q.is_empty() {
        return 0.0;
    }
    let c = tokenize(candidate);
    let matched = q.iter().filter(|t| c.contains(*t)).count();
    matched as f64 / q.len() as f64
}

#[derive(Clone)]
pub struct ProviderSearchService {
    nutrition_providers: Vec<Arc<dyn NutritionProvider>>,
    recipe_providers: Vec<Arc<dyn RecipeProvider>>,
    exercise_providers: Vec<Arc<dyn ExerciseProvider>>,
    cache: SearchCache,
}

impl ProviderSearchService {
    pub fn new(
        nutrition_providers: Vec<Arc<dyn NutritionProvider>>,
        recipe_providers: Vec<Arc<dyn RecipeProvider>>,
        exercise_providers: Vec<Arc<dyn ExerciseProvider>>,
        cache: SearchCache,
    ) -> Self {
        Self {
            nutrition_providers,
            recipe_providers,
            exercise_providers,
            cache,
        }
    }

    pub fn search_ingredients(
        &self,
        query: SearchQuery,
    ) -> impl Stream<Item = ProviderSearchEvent> {
        let (tx, rx) = mpsc::channel::<ProviderSearchEvent>(64);
        let providers = self.nutrition_providers.clone();
        let cache = self.cache.clone();

        tokio::spawn(async move {
            let mut providers_queried: Vec<String> = Vec::new();
            let mut providers_from_cache: Vec<String> = Vec::new();
            let mut handles = Vec::new();

            for provider in &providers {
                let source = provider.source_name().to_string();
                let cache_key = make_cache_key("ingredient", &source, &query);

                if let Some(cached) = cache.get(&cache_key).await {
                    providers_from_cache.push(source.clone());
                    let _ = tx
                        .send(ProviderSearchEvent::Results {
                            source,
                            results: cached,
                            from_cache: true,
                        })
                        .await;
                } else {
                    providers_queried.push(source.clone());
                    let provider_clone = Arc::clone(provider);
                    let query_clone = query.clone();
                    let tx_clone = tx.clone();
                    let cache_clone = cache.clone();

                    handles.push(tokio::spawn(async move {
                        let result = provider_clone.search_ingredients(&query_clone).await;
                        match result {
                            Ok(results) => {
                                cache_clone.insert(cache_key, results.clone()).await;
                                let _ = tx_clone
                                    .send(ProviderSearchEvent::Results {
                                        source,
                                        results,
                                        from_cache: false,
                                    })
                                    .await;
                            }
                            Err(e) => {
                                let _ = tx_clone
                                    .send(ProviderSearchEvent::Error {
                                        source,
                                        error: e.to_string(),
                                    })
                                    .await;
                            }
                        }
                    }));
                }
            }

            for h in handles {
                let _ = h.await;
            }

            let _ = tx
                .send(ProviderSearchEvent::Done {
                    providers_queried,
                    providers_from_cache,
                })
                .await;
        });

        ReceiverStream::new(rx)
    }

    pub fn search_dishes(&self, query: SearchQuery) -> impl Stream<Item = ProviderSearchEvent> {
        let (tx, rx) = mpsc::channel::<ProviderSearchEvent>(64);
        let providers = self.recipe_providers.clone();
        let cache = self.cache.clone();

        tokio::spawn(async move {
            let mut providers_queried: Vec<String> = Vec::new();
            let mut providers_from_cache: Vec<String> = Vec::new();
            let mut handles = Vec::new();

            for provider in &providers {
                let source = provider.source_name().to_string();
                let cache_key = make_cache_key("dish", &source, &query);

                if let Some(cached) = cache.get(&cache_key).await {
                    providers_from_cache.push(source.clone());
                    let _ = tx
                        .send(ProviderSearchEvent::Results {
                            source,
                            results: cached,
                            from_cache: true,
                        })
                        .await;
                } else {
                    providers_queried.push(source.clone());
                    let provider_clone = Arc::clone(provider);
                    let query_clone = query.clone();
                    let tx_clone = tx.clone();
                    let cache_clone = cache.clone();

                    handles.push(tokio::spawn(async move {
                        let result = provider_clone.search_dishes(&query_clone).await;
                        match result {
                            Ok(results) => {
                                cache_clone.insert(cache_key, results.clone()).await;
                                let _ = tx_clone
                                    .send(ProviderSearchEvent::Results {
                                        source,
                                        results,
                                        from_cache: false,
                                    })
                                    .await;
                            }
                            Err(e) => {
                                let _ = tx_clone
                                    .send(ProviderSearchEvent::Error {
                                        source,
                                        error: e.to_string(),
                                    })
                                    .await;
                            }
                        }
                    }));
                }
            }

            for h in handles {
                let _ = h.await;
            }

            let _ = tx
                .send(ProviderSearchEvent::Done {
                    providers_queried,
                    providers_from_cache,
                })
                .await;
        });

        ReceiverStream::new(rx)
    }

    pub fn search_exercises(&self, query: SearchQuery) -> impl Stream<Item = ProviderSearchEvent> {
        let (tx, rx) = mpsc::channel::<ProviderSearchEvent>(64);
        let providers = self.exercise_providers.clone();
        let cache = self.cache.clone();

        tokio::spawn(async move {
            let mut providers_queried: Vec<String> = Vec::new();
            let mut providers_from_cache: Vec<String> = Vec::new();
            let mut handles = Vec::new();

            for provider in &providers {
                let source = provider.source_name().to_string();
                let cache_key = make_cache_key("exercise", &source, &query);

                if let Some(cached) = cache.get(&cache_key).await {
                    providers_from_cache.push(source.clone());
                    let _ = tx
                        .send(ProviderSearchEvent::Results {
                            source,
                            results: cached,
                            from_cache: true,
                        })
                        .await;
                } else {
                    providers_queried.push(source.clone());
                    let provider_clone = Arc::clone(provider);
                    let query_clone = query.clone();
                    let tx_clone = tx.clone();
                    let cache_clone = cache.clone();

                    handles.push(tokio::spawn(async move {
                        let result = provider_clone.search_exercises(&query_clone).await;
                        match result {
                            Ok(results) => {
                                cache_clone.insert(cache_key, results.clone()).await;
                                let _ = tx_clone
                                    .send(ProviderSearchEvent::Results {
                                        source,
                                        results,
                                        from_cache: false,
                                    })
                                    .await;
                            }
                            Err(e) => {
                                let _ = tx_clone
                                    .send(ProviderSearchEvent::Error {
                                        source,
                                        error: e.to_string(),
                                    })
                                    .await;
                            }
                        }
                    }));
                }
            }

            for h in handles {
                let _ = h.await;
            }

            let _ = tx
                .send(ProviderSearchEvent::Done {
                    providers_queried,
                    providers_from_cache,
                })
                .await;
        });

        ReceiverStream::new(rx)
    }

    /// Resolve a free-text meal/dish name to a fully-detailed recipe by searching
    /// the recipe providers in order and fetching the top match by id. Returns
    /// `(source_name, dish)` on the first hit, or `None` on a miss / provider
    /// error (errors are swallowed — treated as a miss, not a failure).
    pub async fn resolve_dish(&self, name: &str) -> Option<(String, ExternalDish)> {
        let query = SearchQuery {
            query: name.to_string(),
            limit: 1,
            exclude_allergens: vec![],
        };
        for provider in &self.recipe_providers {
            let source = provider.source_name().to_string();
            // Reuse the shared TTL cache for the search step (same key scheme as the
            // streaming search_dishes) so synchronous promotion avoids redundant calls.
            let cache_key = make_cache_key("dish", &source, &query);
            let results = if let Some(cached) = self.cache.get(&cache_key).await {
                cached
            } else {
                let Ok(fetched) = provider.search_dishes(&query).await else {
                    continue;
                };
                self.cache.insert(cache_key, fetched.clone()).await;
                fetched
            };
            let Some(top) = results.into_iter().next() else {
                continue;
            };
            // Gate out a loosely-related top hit before paying for the detail
            // fetch — an unconfident name match counts as a miss (#903).
            if name_match_confidence(name, &top.name) < MATCH_CONFIDENCE_THRESHOLD {
                continue;
            }
            if let Ok(Some(dish)) = provider.get_dish_by_id(&top.external_id).await {
                return Some((source, dish));
            }
        }
        None
    }

    /// Resolve a free-text ingredient name to a detailed ingredient (with nutrition)
    /// by searching the nutrition providers in order and fetching the top match by id.
    pub async fn resolve_ingredient(&self, name: &str) -> Option<(String, ExternalIngredient)> {
        let query = SearchQuery {
            query: name.to_string(),
            limit: 1,
            exclude_allergens: vec![],
        };
        for provider in &self.nutrition_providers {
            let source = provider.source_name().to_string();
            // Reuse the shared TTL cache for the search step (same key scheme as the
            // streaming search_ingredients) so synchronous promotion avoids redundant calls.
            let cache_key = make_cache_key("ingredient", &source, &query);
            let results = if let Some(cached) = self.cache.get(&cache_key).await {
                cached
            } else {
                let Ok(fetched) = provider.search_ingredients(&query).await else {
                    continue;
                };
                self.cache.insert(cache_key, fetched.clone()).await;
                fetched
            };
            let Some(top) = results.into_iter().next() else {
                continue;
            };
            // Gate out a loosely-related top hit before paying for the detail
            // fetch — an unconfident name match counts as a miss (#903).
            if name_match_confidence(name, &top.name) < MATCH_CONFIDENCE_THRESHOLD {
                continue;
            }
            if let Ok(Some(ing)) = provider.get_ingredient_by_id(&top.external_id).await {
                return Some((source, ing));
            }
        }
        None
    }

    /// Whether the given source name belongs to a nutrition provider that yields
    /// canonical (generic) ingredient names. Unknown sources are treated as
    /// non-canonical so they sort after canonical results in merged output.
    pub fn is_canonical_source(&self, source: &str) -> bool {
        self.nutrition_providers
            .iter()
            .find(|p| p.source_name() == source)
            .is_some_and(|p| p.is_canonical_source())
    }

    /// Fetch the full detail for a specific external ingredient by `(source, external_id)`.
    /// Used by the promote-on-select flow: the caller already holds the exact id the
    /// user picked, so this fetches that id directly rather than re-running a search.
    /// Returns `None` if no provider matches `source` or the provider has no such id.
    pub async fn fetch_ingredient_detail(
        &self,
        source: &str,
        external_id: &str,
    ) -> Option<ExternalIngredient> {
        let provider = self
            .nutrition_providers
            .iter()
            .find(|p| p.source_name() == source)?;
        provider
            .get_ingredient_by_id(external_id)
            .await
            .ok()
            .flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::SearchCache;
    use std::sync::Arc;

    #[test]
    fn is_canonical_source_reflects_provider_marker() {
        use crate::providers::{OpenFoodFactsProvider, UsdaFdcProvider};

        let svc = ProviderSearchService::new(
            vec![
                Arc::new(UsdaFdcProvider::new("key")),
                Arc::new(OpenFoodFactsProvider::default()),
            ],
            vec![],
            vec![],
            SearchCache::new(36),
        );

        assert!(svc.is_canonical_source("usda_fdc"));
        assert!(!svc.is_canonical_source("openfoodfacts"));
        assert!(
            !svc.is_canonical_source("unknown"),
            "unknown sources default to non-canonical"
        );
    }
}

#[cfg(test)]
mod resolve_tests {
    use super::*;
    use crate::cache::SearchCache;
    use crate::providers::dtos::{
        ExternalDish, ExternalDishIngredient, ExternalIngredient, SearchQuery, SearchResult,
    };
    use crate::providers::error::ExternalProviderError;
    use async_trait::async_trait;

    struct FakeRecipe;
    #[async_trait]
    impl RecipeProvider for FakeRecipe {
        fn source_name(&self) -> &str {
            "themealdb"
        }
        async fn search_dishes(
            &self,
            q: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            if q.query.to_lowercase().contains("soup") {
                Ok(vec![SearchResult {
                    external_id: "r1".into(),
                    name: "Tomato Soup".into(),
                    ..Default::default()
                }])
            } else {
                Ok(vec![])
            }
        }
        async fn get_dish_by_id(
            &self,
            id: &str,
        ) -> Result<Option<ExternalDish>, ExternalProviderError> {
            assert_eq!(id, "r1");
            Ok(Some(ExternalDish {
                external_id: "r1".into(),
                name: "Tomato Soup".into(),
                ingredients: vec![ExternalDishIngredient {
                    name: "Tomato".into(),
                    ..Default::default()
                }],
                ..Default::default()
            }))
        }
    }

    struct FakeNutrition;
    #[async_trait]
    impl NutritionProvider for FakeNutrition {
        fn source_name(&self) -> &str {
            "usda_fdc"
        }
        async fn search_ingredients(
            &self,
            q: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            if q.query.to_lowercase().contains("tomato") {
                Ok(vec![SearchResult {
                    external_id: "i1".into(),
                    name: "Tomato".into(),
                    ..Default::default()
                }])
            } else {
                Ok(vec![])
            }
        }
        async fn get_ingredient_by_id(
            &self,
            id: &str,
        ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
            assert_eq!(id, "i1");
            Ok(Some(ExternalIngredient {
                external_id: "i1".into(),
                name: "Tomato".into(),
                serving_size_g: None,
                nutrition: None,
                allergens: vec![],
            }))
        }
    }

    #[tokio::test]
    async fn resolve_dish_returns_detailed_recipe_on_hit() {
        let svc = ProviderSearchService::new(
            vec![],
            vec![Arc::new(FakeRecipe)],
            vec![],
            SearchCache::new(36),
        );
        let (source, dish) = svc
            .resolve_dish("tomato soup")
            .await
            .expect("expected a recipe hit");
        assert_eq!(source, "themealdb");
        assert_eq!(dish.name, "Tomato Soup");
        assert_eq!(dish.ingredients.len(), 1);
    }

    #[tokio::test]
    async fn resolve_dish_returns_none_on_miss() {
        let svc = ProviderSearchService::new(
            vec![],
            vec![Arc::new(FakeRecipe)],
            vec![],
            SearchCache::new(36),
        );
        assert!(svc.resolve_dish("nonexistent meal").await.is_none());
    }

    #[tokio::test]
    async fn resolve_ingredient_returns_detail_on_hit() {
        let svc = ProviderSearchService::new(
            vec![Arc::new(FakeNutrition)],
            vec![],
            vec![],
            SearchCache::new(36),
        );
        let (source, ing) = svc
            .resolve_ingredient("tomato")
            .await
            .expect("expected an ingredient hit");
        assert_eq!(source, "usda_fdc");
        assert_eq!(ing.name, "Tomato");
    }

    #[tokio::test]
    async fn resolve_ingredient_returns_none_on_miss() {
        let svc = ProviderSearchService::new(
            vec![Arc::new(FakeNutrition)],
            vec![],
            vec![],
            SearchCache::new(36),
        );
        assert!(svc.resolve_ingredient("nonexistent").await.is_none());
    }

    // ── Confidence gate (#903) ───────────────────────────────────────────────

    #[test]
    fn name_match_confidence_scores_token_coverage() {
        // Exact match → full confidence.
        assert_eq!(name_match_confidence("Tomato Soup", "Tomato Soup"), 1.0);
        // Query fully contained in a longer candidate → full confidence.
        assert_eq!(name_match_confidence("chicken", "Chicken Handi"), 1.0);
        // Half the query's tokens present → 0.5.
        assert_eq!(name_match_confidence("tofu bowl", "tofu curry"), 0.5);
        // No shared tokens → zero.
        assert_eq!(name_match_confidence("tofu", "beef stew"), 0.0);
        // Empty query has nothing to match → zero, never a divide-by-zero.
        assert_eq!(name_match_confidence("", "anything"), 0.0);
    }

    /// Returns a real result, but with a name unrelated to any query.
    struct UnrelatedRecipe;
    #[async_trait]
    impl RecipeProvider for UnrelatedRecipe {
        fn source_name(&self) -> &str {
            "themealdb"
        }
        async fn search_dishes(
            &self,
            _q: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            Ok(vec![SearchResult {
                external_id: "x1".into(),
                name: "Beef Wellington".into(),
                ..Default::default()
            }])
        }
        async fn get_dish_by_id(
            &self,
            _id: &str,
        ) -> Result<Option<ExternalDish>, ExternalProviderError> {
            Ok(Some(ExternalDish {
                external_id: "x1".into(),
                name: "Beef Wellington".into(),
                ..Default::default()
            }))
        }
    }

    #[tokio::test]
    async fn resolve_dish_rejects_low_confidence_match() {
        let svc = ProviderSearchService::new(
            vec![],
            vec![Arc::new(UnrelatedRecipe)],
            vec![],
            SearchCache::new(36),
        );
        // The provider would happily return "Beef Wellington", but it shares no
        // tokens with the invented name, so promotion must treat it as a miss.
        assert!(
            svc.resolve_dish("Spicy Peanut Tofu Bowl").await.is_none(),
            "unrelated top hit must be gated out"
        );
    }

    /// Returns a real ingredient with a name unrelated to any query.
    struct UnrelatedNutrition;
    #[async_trait]
    impl NutritionProvider for UnrelatedNutrition {
        fn source_name(&self) -> &str {
            "usda_fdc"
        }
        async fn search_ingredients(
            &self,
            _q: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            Ok(vec![SearchResult {
                external_id: "z1".into(),
                name: "Granulated Sugar".into(),
                ..Default::default()
            }])
        }
        async fn get_ingredient_by_id(
            &self,
            _id: &str,
        ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
            Ok(Some(ExternalIngredient {
                external_id: "z1".into(),
                name: "Granulated Sugar".into(),
                serving_size_g: None,
                nutrition: None,
                allergens: vec![],
            }))
        }
    }

    #[tokio::test]
    async fn resolve_ingredient_rejects_low_confidence_match() {
        let svc = ProviderSearchService::new(
            vec![Arc::new(UnrelatedNutrition)],
            vec![],
            vec![],
            SearchCache::new(36),
        );
        assert!(
            svc.resolve_ingredient("fresh basil").await.is_none(),
            "unrelated top hit must be gated out"
        );
    }

    #[tokio::test]
    async fn fetch_ingredient_detail_returns_detail_for_matching_source() {
        let svc = ProviderSearchService::new(
            vec![Arc::new(FakeNutrition)],
            vec![],
            vec![],
            SearchCache::new(36),
        );
        let detail = svc
            .fetch_ingredient_detail("usda_fdc", "i1")
            .await
            .expect("expected detail for known id");
        assert_eq!(detail.name, "Tomato");
        assert_eq!(detail.external_id, "i1");
    }

    #[tokio::test]
    async fn fetch_ingredient_detail_returns_none_for_unknown_source() {
        let svc = ProviderSearchService::new(
            vec![Arc::new(FakeNutrition)],
            vec![],
            vec![],
            SearchCache::new(36),
        );
        assert!(
            svc.fetch_ingredient_detail("not_a_source", "i1")
                .await
                .is_none()
        );
    }
}
