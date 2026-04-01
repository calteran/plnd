use moka::future::Cache;
use std::time::Duration;

/// Shared state for briefing-related operations.
/// Stored in `AppState`; cloned cheaply (all fields are `Arc`-backed).
#[derive(Clone)]
pub struct BriefingState {
    pub weather_cache: Cache<String, WeatherCacheEntry>,
    pub news_cache: Cache<String, Vec<String>>,
    pub http: reqwest::Client,
    pub weather_latitude: f64,
    pub weather_longitude: f64,
    pub news_feed_url: String,
}

/// Cached weather data.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct WeatherCacheEntry {
    pub temp_c: f64,
    pub condition: String,
    pub high_c: f64,
    pub low_c: f64,
    pub precipitation_flag: bool,
}

impl BriefingState {
    pub fn new(weather_latitude: f64, weather_longitude: f64, news_feed_url: String) -> Self {
        // Cache keys are location-based (lat/lon) and feed-URL-based, NOT per-user.
        // All authenticated users share the same cached responses — a single Open-Meteo
        // call serves the whole instance for up to 1 hour. This is intentional: weather
        // and news are not personal data. If per-user location is added later, the cache
        // key naturally becomes the user's coordinates, and users in the same area will
        // still share entries.
        let weather_cache = Cache::builder()
            .max_capacity(100)
            .time_to_live(Duration::from_secs(3600))
            .build();
        let news_cache = Cache::builder()
            .max_capacity(100)
            .time_to_live(Duration::from_secs(1800))
            .build();
        let http = reqwest::Client::builder()
            .user_agent("plnd-api/0.1")
            .build()
            .expect("failed to build HTTP client for briefing");
        Self {
            weather_cache,
            news_cache,
            http,
            weather_latitude,
            weather_longitude,
            news_feed_url,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn briefing_state_stores_config_values() {
        let state = BriefingState::new(51.5074, -0.1278, "https://example.com/feed".to_string());
        assert_eq!(state.weather_latitude, 51.5074);
        assert_eq!(state.weather_longitude, -0.1278);
        assert_eq!(state.news_feed_url, "https://example.com/feed");
    }
}
