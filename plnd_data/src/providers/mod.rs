pub mod dtos;
pub mod error;
pub mod exercise;
pub mod news;

#[cfg(debug_assertions)]
pub mod news_fixture;
pub mod nutrition;
pub mod open_food_facts;
pub mod recipe;
pub mod themealdb;
pub mod usda_fdc;
pub mod weather;

#[cfg(debug_assertions)]
pub mod weather_fixture;

pub use dtos::Location;
pub use error::ExternalProviderError;
pub use exercise::ExerciseProvider;
pub use news::{NewsHeadline, NewsProvider, NewsQuery, RssFeedProvider};

#[cfg(debug_assertions)]
pub use news_fixture::FixtureNewsProvider;
pub use nutrition::NutritionProvider;
pub use open_food_facts::OpenFoodFactsProvider;
pub use recipe::RecipeProvider;
pub use themealdb::TheMealDbProvider;
pub use usda_fdc::UsdaFdcProvider;
pub use weather::{OpenMeteoProvider, WeatherData, WeatherProvider};

#[cfg(debug_assertions)]
pub use weather_fixture::FixtureWeatherProvider;

// TODO: update to production app name/URL before launch (required by Open Food Facts TOS etc.)
pub(crate) const USER_AGENT: &str = concat!("com.tingeese.plnd-dev/", env!("CARGO_PKG_VERSION"));

pub(crate) fn build_http_client() -> reqwest::Client {
    use reqwest::header::{ACCEPT_LANGUAGE, HeaderMap, HeaderValue};

    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en"));

    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .default_headers(headers)
        .build()
        .expect("failed to build HTTP client")
}

#[cfg(test)]
mod tests {
    use super::USER_AGENT;

    #[test]
    fn user_agent_has_plnd_dev_prefix() {
        assert!(
            USER_AGENT.starts_with("com.tingeese.plnd-dev/"),
            "USER_AGENT: {}",
            USER_AGENT
        );
    }

    #[test]
    fn user_agent_contains_version() {
        let version = USER_AGENT.strip_prefix("com.tingeese.plnd-dev/").unwrap();
        assert!(!version.is_empty());
        assert!(
            version.contains('.'),
            "version should contain a dot: {}",
            version
        );
    }
}
