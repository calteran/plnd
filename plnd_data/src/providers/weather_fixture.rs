//! Fixture-backed `WeatherProvider` for e2e tests.
//!
//! Reads a captured Open-Meteo response from disk instead of issuing a network
//! request. Only compiled in debug builds so release binaries cannot accidentally
//! serve fixtures.

#![cfg(debug_assertions)]

use std::path::PathBuf;

use async_trait::async_trait;

use crate::providers::dtos::Location;
use crate::providers::error::ExternalProviderError;
use crate::providers::weather::{
    OpenMeteoResponse, WeatherData, WeatherProvider, weather_code_to_condition,
};

#[derive(Debug)]
pub struct FixtureWeatherProvider {
    forecast_path: PathBuf,
}

impl FixtureWeatherProvider {
    pub fn new(forecast_path: PathBuf) -> Result<Self, ExternalProviderError> {
        if !forecast_path.is_file() {
            return Err(ExternalProviderError::ConfigurationError(format!(
                "fixture forecast file not found: {}",
                forecast_path.display()
            )));
        }
        Ok(Self { forecast_path })
    }
}

#[async_trait]
impl WeatherProvider for FixtureWeatherProvider {
    #[tracing::instrument(
        name = "provider::weather_fixture::current",
        skip(self),
        fields(provider = "weather_fixture")
    )]
    async fn current(&self, _location: Location) -> Result<WeatherData, ExternalProviderError> {
        let bytes = std::fs::read(&self.forecast_path).map_err(|e| {
            ExternalProviderError::ConfigurationError(format!(
                "failed to read fixture {}: {e}",
                self.forecast_path.display()
            ))
        })?;
        let resp: OpenMeteoResponse = serde_json::from_slice(&bytes)
            .map_err(|e| ExternalProviderError::ResponseParseError(e.to_string()))?;
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

    const FORECAST_JSON: &str = r#"{
        "current": {
            "temperature_2m": 18.5,
            "precipitation": 1.2,
            "weather_code": 61
        },
        "daily": {
            "temperature_2m_max": [22.4],
            "temperature_2m_min": [12.1]
        }
    }"#;

    #[tokio::test]
    async fn current_reads_forecast_from_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("forecast.json");
        std::fs::write(&path, FORECAST_JSON).unwrap();

        let provider = FixtureWeatherProvider::new(path).unwrap();
        let data = provider
            .current(Location {
                latitude: 51.5074,
                longitude: -0.1278,
            })
            .await
            .unwrap();

        assert_eq!(data.temperature_c, 18.5);
        assert_eq!(data.condition, "Rainy");
        assert_eq!(data.high_c, 22.4);
        assert_eq!(data.low_c, 12.1);
        assert_eq!(data.precipitation_mm, 1.2);
    }

    #[tokio::test]
    async fn new_returns_error_when_path_missing() {
        let err = FixtureWeatherProvider::new(PathBuf::from("/nonexistent/path/forecast.json"))
            .unwrap_err();
        assert!(matches!(err, ExternalProviderError::ConfigurationError(_)));
    }

    #[tokio::test]
    async fn current_returns_parse_error_on_invalid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("forecast.json");
        std::fs::write(&path, "not json at all").unwrap();

        let provider = FixtureWeatherProvider::new(path).unwrap();
        let err = provider
            .current(Location {
                latitude: 0.0,
                longitude: 0.0,
            })
            .await
            .unwrap_err();
        assert!(matches!(err, ExternalProviderError::ResponseParseError(_)));
    }
}
