use crate::auth::jwt::Claims;
use crate::db;
use crate::state::AppState;
use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{NaiveDate, Utc};
use plnd_data::clients::{Location, NewsQuery};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

// ── Query params ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct LocQuery {
    pub loc: Option<String>,
}

/// Parse `"<lat>,<lon>"` into a `Location`. Returns `None` if missing or malformed.
fn parse_loc(s: &str) -> Option<Location> {
    let (lat_str, lon_str) = s.split_once(',')?;
    let latitude = lat_str.trim().parse::<f64>().ok()?;
    let longitude = lon_str.trim().parse::<f64>().ok()?;
    if !latitude.is_finite() || !longitude.is_finite() {
        return None;
    }
    Some(Location {
        latitude,
        longitude,
    })
}

/// Round location to 1 decimal place for cache key stability (~11 km grid).
fn round_location(loc: Location) -> Location {
    Location {
        latitude: (loc.latitude * 10.0).round() / 10.0,
        longitude: (loc.longitude * 10.0).round() / 10.0,
    }
}

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct WeatherResponse {
    pub temperature_c: f64,
    pub condition: String,
    pub high_c: f64,
    pub low_c: f64,
    pub precipitation_mm: f64,
}

impl From<plnd_data::clients::WeatherData> for WeatherResponse {
    fn from(d: plnd_data::clients::WeatherData) -> Self {
        Self {
            temperature_c: d.temperature_c,
            condition: d.condition,
            high_c: d.high_c,
            low_c: d.low_c,
            precipitation_mm: d.precipitation_mm,
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NewsHeadlineResponse {
    pub title: String,
    pub url: Option<String>,
}

impl From<plnd_data::clients::NewsHeadline> for NewsHeadlineResponse {
    fn from(h: plnd_data::clients::NewsHeadline) -> Self {
        Self {
            title: h.title,
            url: h.url,
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NewsResponse {
    pub headlines: Vec<NewsHeadlineResponse>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct YesterdayResponse {
    pub tasks_total: i64,
    pub tasks_done: i64,
    pub meals_planned: i64,
    pub meals_logged: i64,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/briefing/weather",
    tag = "Briefing",
    params(("loc" = String, Query, description = "Location as \"lat,lon\" e.g. \"51.5,-0.1\"")),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Current weather summary", body = WeatherResponse),
        (status = 400, description = "Missing or malformed ?loc= parameter"),
        (status = 401, description = "Unauthorized"),
        (status = 503, description = "Weather service unavailable"),
    )
)]
pub async fn get_weather(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<LocQuery>,
) -> Result<Json<WeatherResponse>, StatusCode> {
    let _user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let loc_str = params.loc.ok_or(StatusCode::BAD_REQUEST)?;
    let location = parse_loc(&loc_str).ok_or(StatusCode::BAD_REQUEST)?;
    let location = round_location(location);

    let cache_key = format!("{:.1},{:.1}", location.latitude, location.longitude);

    if let Some(cached) = state.briefing.weather_cache.get(&cache_key).await {
        return Ok(Json(WeatherResponse::from(cached)));
    }

    let data = state
        .briefing
        .weather
        .current(location)
        .await
        .map_err(|e| {
            eprintln!("weather fetch error: {e}");
            StatusCode::SERVICE_UNAVAILABLE
        })?;

    state
        .briefing
        .weather_cache
        .insert(cache_key, data.clone())
        .await;
    Ok(Json(WeatherResponse::from(data)))
}

#[utoipa::path(
    get,
    path = "/briefing/news",
    tag = "Briefing",
    params(("loc" = String, Query, description = "Location as \"lat,lon\" e.g. \"51.5,-0.1\"")),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Latest news headlines", body = NewsResponse),
        (status = 400, description = "Missing or malformed ?loc= parameter"),
        (status = 401, description = "Unauthorized"),
        (status = 503, description = "News feed unavailable"),
    )
)]
pub async fn get_news(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<LocQuery>,
) -> Result<Json<NewsResponse>, StatusCode> {
    let _user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let loc_str = params.loc.ok_or(StatusCode::BAD_REQUEST)?;
    let location = parse_loc(&loc_str).ok_or(StatusCode::BAD_REQUEST)?;
    let location = round_location(location);

    let cache_key = format!("{:.1},{:.1}", location.latitude, location.longitude);

    if let Some(cached) = state.briefing.news_cache.get(&cache_key).await {
        let headlines = cached.into_iter().map(NewsHeadlineResponse::from).collect();
        return Ok(Json(NewsResponse { headlines }));
    }

    let query = NewsQuery {
        location,
        feed_url: None,
        limit: 3,
    };

    let data = state.briefing.news.headlines(query).await.map_err(|e| {
        eprintln!("news fetch error: {e}");
        StatusCode::SERVICE_UNAVAILABLE
    })?;

    state
        .briefing
        .news_cache
        .insert(cache_key, data.clone())
        .await;
    let headlines = data.into_iter().map(NewsHeadlineResponse::from).collect();
    Ok(Json(NewsResponse { headlines }))
}

#[utoipa::path(
    get,
    path = "/briefing/yesterday",
    tag = "Briefing",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Yesterday's task and meal recap", body = YesterdayResponse),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
pub async fn get_yesterday(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<YesterdayResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    let yesterday: NaiveDate = Utc::now().date_naive() - chrono::Duration::days(1);

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

// ── Pure function tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_loc_valid() {
        let loc = parse_loc("51.5074,-0.1278").unwrap();
        assert!((loc.latitude - 51.5074).abs() < 1e-9);
        assert!((loc.longitude - (-0.1278)).abs() < 1e-9);
    }

    #[test]
    fn parse_loc_with_spaces() {
        let loc = parse_loc("51.5, -0.1").unwrap();
        assert!((loc.latitude - 51.5).abs() < 1e-9);
    }

    #[test]
    fn parse_loc_missing_comma_returns_none() {
        assert!(parse_loc("51.5074").is_none());
    }

    #[test]
    fn parse_loc_non_numeric_returns_none() {
        assert!(parse_loc("abc,def").is_none());
    }

    #[test]
    fn parse_loc_nan_returns_none() {
        assert!(parse_loc("nan,0.0").is_none());
    }

    #[test]
    fn round_location_1dp() {
        let loc = round_location(Location {
            latitude: 51.5074,
            longitude: -0.1278,
        });
        assert!((loc.latitude - 51.5).abs() < 1e-9);
        assert!((loc.longitude - (-0.1)).abs() < 1e-9);
    }

    #[test]
    fn round_location_rounds_up() {
        let loc = round_location(Location {
            latitude: 51.55,
            longitude: 0.0,
        });
        assert!((loc.latitude - 51.6).abs() < 1e-9);
    }
}
