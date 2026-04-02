use moka::future::Cache;
use plnd_data::clients::{NewsHeadline, NewsProvider, WeatherData, WeatherProvider};
use std::sync::Arc;
use std::time::Duration;

/// Shared briefing state stored in `AppState`.
/// All fields are `Arc`-backed so `Clone` is cheap.
#[derive(Clone)]
pub struct BriefingState {
    pub weather: Arc<dyn WeatherProvider>,
    pub news: Arc<dyn NewsProvider>,
    /// Keyed by rounded location string: `"{lat:.1},{lon:.1}"`.
    /// TTL: 1 hour. Shared across all users.
    pub weather_cache: Cache<String, WeatherData>,
    /// Keyed by rounded location string. TTL: 30 minutes. Shared across all users.
    pub news_cache: Cache<String, Vec<NewsHeadline>>,
}

impl BriefingState {
    pub fn new(weather: Arc<dyn WeatherProvider>, news: Arc<dyn NewsProvider>) -> Self {
        let weather_cache = Cache::builder()
            .max_capacity(100)
            .time_to_live(Duration::from_secs(3600))
            .build();
        let news_cache = Cache::builder()
            .max_capacity(100)
            .time_to_live(Duration::from_secs(1800))
            .build();
        Self {
            weather,
            news,
            weather_cache,
            news_cache,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plnd_data::clients::{Location, NewsQuery, WeatherData};

    struct AlwaysSunnyWeather;

    #[async_trait::async_trait]
    impl WeatherProvider for AlwaysSunnyWeather {
        async fn current(
            &self,
            _location: Location,
        ) -> Result<WeatherData, plnd_data::clients::ExternalClientError> {
            Ok(WeatherData {
                temperature_c: 22.0,
                condition: "Clear sky".to_string(),
                high_c: 25.0,
                low_c: 18.0,
                precipitation_mm: 0.0,
            })
        }
    }

    struct EmptyNews;

    #[async_trait::async_trait]
    impl NewsProvider for EmptyNews {
        async fn headlines(
            &self,
            _query: NewsQuery,
        ) -> Result<Vec<NewsHeadline>, plnd_data::clients::ExternalClientError> {
            Ok(vec![])
        }
    }

    #[test]
    fn briefing_state_constructs_without_panic() {
        let _state = BriefingState::new(Arc::new(AlwaysSunnyWeather), Arc::new(EmptyNews));
    }
}
