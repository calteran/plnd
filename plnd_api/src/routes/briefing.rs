use crate::auth::jwt::Claims;
use crate::briefing::WeatherCacheEntry;
use crate::db;
use crate::state::AppState;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use chrono::{Local, NaiveDate};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

// ── Response types ────────────────────────────────────────────────────────────

/// `GET /briefing/weather` response
pub type WeatherResponse = WeatherCacheEntry;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NewsResponse {
    pub headlines: Vec<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct YesterdayResponse {
    pub tasks_total: i64,
    pub tasks_done: i64,
    pub meals_planned: i64,
    pub meals_logged: i64,
}

// ── Open-Meteo deserialization structs (internal) ─────────────────────────────

#[derive(serde::Deserialize)]
struct OpenMeteoResponse {
    current: OpenMeteoCurrentData,
    daily: OpenMeteoDailyData,
}

#[derive(serde::Deserialize)]
struct OpenMeteoCurrentData {
    temperature_2m: f64,
    precipitation: f64,
    weather_code: u32,
}

#[derive(serde::Deserialize)]
struct OpenMeteoDailyData {
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn get_weather(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<WeatherResponse>, StatusCode> {
    let _user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let lat = state.briefing.weather_latitude;
    let lon = state.briefing.weather_longitude;
    // Cache key is location-based, not user-based: all users share a single entry.
    let cache_key = format!("weather:{lat:.4}:{lon:.4}");

    if let Some(cached) = state.briefing.weather_cache.get(&cache_key).await {
        return Ok(Json(cached));
    }

    let url = format!(
        "https://api.open-meteo.com/v1/forecast\
         ?latitude={lat}&longitude={lon}\
         &current=temperature_2m,precipitation,weather_code\
         &daily=temperature_2m_max,temperature_2m_min\
         &forecast_days=1"
    );

    let resp: OpenMeteoResponse = state
        .briefing
        .http
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            eprintln!("weather fetch error: {e}");
            StatusCode::SERVICE_UNAVAILABLE
        })?
        .json()
        .await
        .map_err(|e| {
            eprintln!("weather parse error: {e}");
            StatusCode::SERVICE_UNAVAILABLE
        })?;

    let summary = WeatherCacheEntry {
        temp_c: resp.current.temperature_2m,
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
        precipitation_flag: resp.current.precipitation > 0.0,
    };

    state
        .briefing
        .weather_cache
        .insert(cache_key, summary.clone())
        .await;
    Ok(Json(summary))
}

pub async fn get_news(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<NewsResponse>, StatusCode> {
    let _user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if state.briefing.news_feed_url.is_empty() {
        return Ok(Json(NewsResponse { headlines: vec![] }));
    }

    let feed_url = &state.briefing.news_feed_url;

    // Cache key is the feed URL — all users share a single entry per feed.
    if let Some(cached) = state.briefing.news_cache.get(feed_url).await {
        return Ok(Json(NewsResponse { headlines: cached }));
    }

    let bytes = state
        .briefing
        .http
        .get(feed_url)
        .send()
        .await
        .map_err(|e| {
            eprintln!("news fetch error: {e}");
            StatusCode::SERVICE_UNAVAILABLE
        })?
        .bytes()
        .await
        .map_err(|e| {
            eprintln!("news read error: {e}");
            StatusCode::SERVICE_UNAVAILABLE
        })?;

    let headlines = parse_feed_headlines(&bytes).map_err(|e| {
        eprintln!("news parse error: {e}");
        StatusCode::SERVICE_UNAVAILABLE
    })?;

    state
        .briefing
        .news_cache
        .insert(feed_url.clone(), headlines.clone())
        .await;
    Ok(Json(NewsResponse { headlines }))
}

pub async fn get_yesterday(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<YesterdayResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    // yesterday = today - 1 day, in local wall-clock time
    let yesterday: NaiveDate = Local::now().date_naive() - chrono::Duration::days(1);

    let snapshot = db::briefing::yesterday_snapshot(pool, user_id, yesterday)
        .await
        .map_err(|e| {
            eprintln!("yesterday_snapshot error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(YesterdayResponse {
        tasks_total: snapshot.tasks_total,
        tasks_done: snapshot.tasks_done,
        meals_planned: snapshot.meals_planned,
        meals_logged: snapshot.meals_logged,
    }))
}

// ── Pure functions ─────────────────────────────────────────────────────────────

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

pub fn parse_feed_headlines(content: &[u8]) -> Result<Vec<String>, String> {
    use feed_rs::parser;
    let feed = parser::parse(content).map_err(|e| e.to_string())?;
    let headlines = feed
        .entries
        .iter()
        .filter_map(|e| e.title.as_ref().map(|t| t.content.clone()))
        .take(3)
        .collect();
    Ok(headlines)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weather_code_0_is_clear() {
        assert_eq!(weather_code_to_condition(0), "Clear sky");
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
    fn parse_feed_headlines_returns_up_to_3() {
        let rss = br#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Headline One</title></item>
  <item><title>Headline Two</title></item>
  <item><title>Headline Three</title></item>
  <item><title>Headline Four - should be excluded</title></item>
</channel></rss>"#;
        let result = parse_feed_headlines(rss).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result[0], "Headline One");
        assert_eq!(result[2], "Headline Three");
    }

    #[test]
    fn parse_feed_headlines_empty_feed_returns_empty_vec() {
        let rss = br#"<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>"#;
        let result = parse_feed_headlines(rss).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_feed_handles_fewer_than_3_items() {
        let rss = br#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Only One</title></item>
</channel></rss>"#;
        let result = parse_feed_headlines(rss).unwrap();
        assert_eq!(result.len(), 1);
    }
}
