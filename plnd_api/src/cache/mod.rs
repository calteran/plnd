use std::time::Duration;

use moka::future::Cache;

use crate::clients::dtos::{SearchQuery, SearchResult};

#[derive(Clone)]
pub struct SearchCache {
    inner: Cache<String, Vec<SearchResult>>,
}

impl SearchCache {
    pub fn new(ttl_hours: u64) -> Self {
        let inner = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(Duration::from_secs(ttl_hours * 3600))
            .build();
        Self { inner }
    }

    pub async fn get(&self, key: &str) -> Option<Vec<SearchResult>> {
        self.inner.get(key).await
    }

    pub async fn insert(&self, key: String, results: Vec<SearchResult>) {
        self.inner.insert(key, results).await;
    }
}

/// Cache key format: "{entity}:{provider}:{lowercase_trimmed_q}:{limit}:{sorted_allergens_csv}"
pub fn make_cache_key(entity: &str, provider: &str, query: &SearchQuery) -> String {
    let q = query.query.trim().to_lowercase();
    let limit = query.limit;
    let mut allergens = query.exclude_allergens.clone();
    allergens.sort();
    let allergens_csv = allergens.join(",");
    format!("{entity}:{provider}:{q}:{limit}:{allergens_csv}")
}
