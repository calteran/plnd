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

// ── Placeholder impl (OpenMeteoProvider added in Task 3) ──────────────────────

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
}
