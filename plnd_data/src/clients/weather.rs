use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::clients::dtos::Location;
use crate::clients::error::ExternalClientError;

// ── Public types ──────────────────────────────────────────────────────────────

/// Data returned by any `WeatherProvider` implementation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherData {
    pub temperature_c: f64,
    pub condition: String,
    pub high_c: f64,
    pub low_c: f64,
    pub precipitation_mm: f64,
}

/// Trait for fetching current weather at a given location.
/// `location` is passed at call time so a single provider instance can serve
/// any location. Implementations must be `Send + Sync` for use behind `Arc`.
#[async_trait]
pub trait WeatherProvider: Send + Sync {
    async fn current(&self, location: Location) -> Result<WeatherData, ExternalClientError>;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/// Map an Open-Meteo WMO weather interpretation code to a human-readable string.
/// See: https://open-meteo.com/en/docs#weathervariables (WMO Weather interpretation codes)
pub fn weather_code_to_condition(code: u32) -> &'static str {
    match code {
        0 => "Clear sky",
        1..=3 => "Partly cloudy",
        45 | 48 => "Foggy",
        51..=67 => "Rainy",
        71..=86 => "Snowy",
        95..=99 => "Thunderstorm",
        _ => "Cloudy",
    }
}

// ── Internal serde types ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct OpenMeteoResponse {
    current: OpenMeteoCurrentData,
    daily: OpenMeteoDailyData,
}

#[derive(Deserialize)]
struct OpenMeteoCurrentData {
    temperature_2m: f64,
    precipitation: f64,
    weather_code: u32,
}

#[derive(Deserialize)]
struct OpenMeteoDailyData {
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
}

// ── OpenMeteoProvider ─────────────────────────────────────────────────────────

/// Fetches weather from the free Open-Meteo API (no API key required).
pub struct OpenMeteoProvider {
    http: reqwest::Client,
}

impl OpenMeteoProvider {
    pub fn new() -> Self {
        Self {
            http: super::build_http_client(),
        }
    }
}

impl Default for OpenMeteoProvider {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn build_open_meteo_url(lat: f64, lon: f64) -> String {
    format!(
        "https://api.open-meteo.com/v1/forecast\
         ?latitude={lat}&longitude={lon}\
         &current=temperature_2m,precipitation,weather_code\
         &daily=temperature_2m_max,temperature_2m_min\
         &forecast_days=1"
    )
}

#[async_trait]
impl WeatherProvider for OpenMeteoProvider {
    async fn current(&self, location: Location) -> Result<WeatherData, ExternalClientError> {
        let url = build_open_meteo_url(location.latitude, location.longitude);

        let resp = self.http.get(&url).send().await?;

        let status = resp.status();
        if !status.is_success() {
            return Err(ExternalClientError::HttpError(format!(
                "HTTP {}",
                status.as_u16()
            )));
        }

        let resp: OpenMeteoResponse = resp
            .json()
            .await
            .map_err(|e| ExternalClientError::ResponseParseError(e.to_string()))?;

        Ok(WeatherData {
            temperature_c: resp.current.temperature_2m,
            condition: weather_code_to_condition(resp.current.weather_code).to_string(),
            high_c: resp
                .daily
                .temperature_2m_max
                .first()
                .copied()
                .unwrap_or(0.0),
            low_c: resp
                .daily
                .temperature_2m_min
                .first()
                .copied()
                .unwrap_or(0.0),
            precipitation_mm: resp.current.precipitation,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weather_code_0_is_clear() {
        assert_eq!(weather_code_to_condition(0), "Clear sky");
    }

    #[test]
    fn weather_code_1_is_partly_cloudy() {
        assert_eq!(weather_code_to_condition(1), "Partly cloudy");
    }

    #[test]
    fn weather_code_61_is_rainy() {
        assert_eq!(weather_code_to_condition(61), "Rainy");
    }

    #[test]
    fn weather_code_71_is_snowy() {
        assert_eq!(weather_code_to_condition(71), "Snowy");
    }

    #[test]
    fn weather_code_95_is_thunderstorm() {
        assert_eq!(weather_code_to_condition(95), "Thunderstorm");
    }

    #[test]
    fn weather_code_unknown_is_cloudy() {
        assert_eq!(weather_code_to_condition(200), "Cloudy");
    }

    #[test]
    fn open_meteo_url_contains_coordinates() {
        let url = build_open_meteo_url(51.5, -0.1);
        assert!(url.contains("latitude=51.5"), "url: {url}");
        assert!(url.contains("longitude=-0.1"), "url: {url}");
        assert!(url.contains("forecast_days=1"), "url: {url}");
    }
}
