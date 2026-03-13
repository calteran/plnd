use std::sync::Arc;

use futures::stream::Stream;
use serde::Serialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::cache::{make_cache_key, SearchCache};
use crate::clients::dtos::{SearchQuery, SearchResult};
use crate::clients::exercise::ExerciseProvider;
use crate::clients::nutrition::NutritionProvider;
use crate::clients::recipe::RecipeProvider;

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
}
