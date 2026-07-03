use moka::future::Cache;
use plnd_data::providers::{NewsHeadline, NewsProvider};
use std::sync::Arc;
use std::time::Duration;

/// Shared briefing state stored in `AppState`.
/// All fields are `Arc`-backed so `Clone` is cheap.
#[derive(Clone)]
pub struct BriefingState {
    pub news: Arc<dyn NewsProvider>,
    /// Keyed by rounded location string: `"{lat:.1},{lon:.1}"`.
    /// TTL: 30 minutes. Shared across all users.
    pub news_cache: Cache<String, Vec<NewsHeadline>>,
}

impl BriefingState {
    pub fn new(news: Arc<dyn NewsProvider>) -> Self {
        let news_cache = Cache::builder()
            .max_capacity(100)
            .time_to_live(Duration::from_secs(1800))
            .build();
        Self { news, news_cache }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plnd_data::providers::{NewsHeadline, NewsQuery};

    struct EmptyNews;

    #[async_trait::async_trait]
    impl NewsProvider for EmptyNews {
        async fn headlines(
            &self,
            _query: NewsQuery,
        ) -> Result<Vec<NewsHeadline>, plnd_data::providers::ExternalProviderError> {
            Ok(vec![])
        }
    }

    #[test]
    fn briefing_state_constructs_without_panic() {
        let _state = BriefingState::new(Arc::new(EmptyNews));
    }
}
