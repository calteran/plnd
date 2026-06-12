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
            let Ok(results) = provider.search_dishes(&query).await else {
                continue;
            };
            let Some(top) = results.into_iter().next() else {
                continue;
            };
            if let Ok(Some(dish)) = provider.get_dish_by_id(&top.external_id).await {
                return Some((provider.source_name().to_string(), dish));
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
            let Ok(results) = provider.search_ingredients(&query).await else {
                continue;
            };
            let Some(top) = results.into_iter().next() else {
                continue;
            };
            if let Ok(Some(ing)) = provider.get_ingredient_by_id(&top.external_id).await {
                return Some((provider.source_name().to_string(), ing));
            }
        }
        None
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
                occasion_tags: vec![],
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
}
