# Weather & News Provider Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract weather and news fetching from inline route handler logic into `WeatherProvider` / `NewsProvider` traits with `OpenMeteoProvider` / `RssFeedProvider` implementations in `plnd_data/src/clients/`.

**Architecture:** Two new files in `plnd_data/src/clients/` follow the exact pattern of `usda_fdc.rs` and `themealdb.rs`: a public trait, a concrete impl struct, and private serde types. `BriefingState` in `plnd_api` switches from holding raw config + HTTP client to holding `Arc<dyn WeatherProvider>` + `Arc<dyn NewsProvider>`; the Moka caches stay in `BriefingState` (API-layer concern). Route handlers gain a `?loc=<lat>,<lon>` query param and delegate all HTTP calls to providers.

**Tech Stack:** Rust, async-trait 0.1, reqwest 0.13, feed-rs 2, moka 0.12, axum 0.8, utoipa 5.4. Tests use `cargo nextest` via `just test-ci`.

---

## File Map

| Action | Path | What changes |
|--------|------|--------------|
| Modify | `plnd_data/src/clients/dtos.rs` | Add `Location` struct |
| Create | `plnd_data/src/clients/weather.rs` | `WeatherProvider` trait, `WeatherData`, `OpenMeteoProvider`, `weather_code_to_condition()` |
| Create | `plnd_data/src/clients/news.rs` | `NewsProvider` trait, `NewsHeadline`, `NewsQuery`, `RssFeedProvider`, `parse_feed_headlines()` |
| Modify | `plnd_data/src/clients/mod.rs` | Add module declarations + re-exports |
| Modify | `plnd_data/Cargo.toml` | Add `feed-rs = "2"` |
| Modify | `plnd_api/Cargo.toml` | Remove `feed-rs` |
| Modify | `plnd_api/src/config/settings.rs` | Remove `weather_latitude`, `weather_longitude` fields |
| Modify | `plnd_api/src/briefing.rs` | Replace config fields + HTTP client with provider trait objects |
| Modify | `plnd_api/src/routes/briefing.rs` | Add `?loc=` param, delegate to providers, add response DTOs |
| Modify | `plnd_api/src/main.rs` | Construct and inject provider instances |
| Modify | `plnd_api/src/openapi.rs` | Update schema registration (`WeatherCacheEntry` → `WeatherResponse`) |

---

## Task 1: Add `Location` DTO and `feed-rs` dependency

**Files:**
- Modify: `plnd_data/src/clients/dtos.rs`
- Modify: `plnd_data/Cargo.toml`

- [ ] **Step 1: Add `Location` to dtos.rs**

In `plnd_data/src/clients/dtos.rs`, add after the existing imports at the top of the file:

```rust
/// Geographic coordinate pair used by weather and news providers.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
}
```

- [ ] **Step 2: Add `feed-rs` to plnd_data/Cargo.toml**

In `[dependencies]` section of `plnd_data/Cargo.toml`, add after `futures`:

```toml
feed-rs = "2"
```

- [ ] **Step 3: Verify compilation**

```bash
just verify-build
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add plnd_data/src/clients/dtos.rs plnd_data/Cargo.toml
git commit -m "feat(plnd_data): add Location DTO and feed-rs dependency for briefing providers"
```

---

## Task 2: Create WeatherProvider trait and pure functions (TDD)

**Files:**
- Create: `plnd_data/src/clients/weather.rs`

- [ ] **Step 1: Write failing tests for `weather_code_to_condition`**

Create `plnd_data/src/clients/weather.rs` with only the tests (no implementation yet):

```rust
// plnd_data/src/clients/weather.rs

pub fn weather_code_to_condition(_code: u32) -> &'static str {
    todo!("implement")
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
}
```

- [ ] **Step 2: Add `pub mod weather;` to plnd_data/src/clients/mod.rs**

Add to `plnd_data/src/clients/mod.rs` (after `pub mod usda_fdc;`):

```rust
pub mod weather;
```

- [ ] **Step 3: Run tests and confirm they panic (todo!)**

```bash
cargo test -p plnd_data weather_code 2>&1 | head -30
```

Expected: tests run and fail with `not yet implemented`.

- [ ] **Step 4: Implement `weather_code_to_condition` and add types**

Replace the full contents of `plnd_data/src/clients/weather.rs`:

```rust
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
```

- [ ] **Step 5: Run tests and confirm they pass**

```bash
cargo test -p plnd_data weather_code 2>&1
```

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add plnd_data/src/clients/weather.rs plnd_data/src/clients/mod.rs
git commit -m "feat(plnd_data): add WeatherProvider trait, WeatherData, and weather_code_to_condition"
```

---

## Task 3: Implement OpenMeteoProvider

**Files:**
- Modify: `plnd_data/src/clients/weather.rs`

- [ ] **Step 1: Write a failing test for URL building**

Add to the `#[cfg(test)]` block in `weather.rs`:

```rust
    #[test]
    fn open_meteo_url_contains_coordinates() {
        let url = build_open_meteo_url(51.5, -0.1);
        assert!(url.contains("latitude=51.5"), "url: {url}");
        assert!(url.contains("longitude=-0.1"), "url: {url}");
        assert!(url.contains("forecast_days=1"), "url: {url}");
    }
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cargo test -p plnd_data open_meteo_url 2>&1
```

Expected: compile error — `build_open_meteo_url` not found.

- [ ] **Step 3: Add `OpenMeteoProvider` and helpers to weather.rs**

Add after the `weather_code_to_condition` function (before `#[cfg(test)]`):

```rust
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
        Self { http: super::build_http_client() }
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

        let resp: OpenMeteoResponse = self
            .http
            .get(&url)
            .send()
            .await?
            .json()
            .await
            .map_err(|e| ExternalClientError::ResponseParseError(e.to_string()))?;

        Ok(WeatherData {
            temperature_c: resp.current.temperature_2m,
            condition: weather_code_to_condition(resp.current.weather_code).to_string(),
            high_c: resp.daily.temperature_2m_max.first().copied().unwrap_or(0.0),
            low_c: resp.daily.temperature_2m_min.first().copied().unwrap_or(0.0),
            precipitation_mm: resp.current.precipitation,
        })
    }
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cargo test -p plnd_data weather 2>&1
```

Expected: 7 tests pass (6 weather_code + 1 url test).

- [ ] **Step 5: Commit**

```bash
git add plnd_data/src/clients/weather.rs
git commit -m "feat(plnd_data): implement OpenMeteoProvider"
```

---

## Task 4: Create NewsProvider trait and parse_feed_headlines (TDD)

**Files:**
- Create: `plnd_data/src/clients/news.rs`

- [ ] **Step 1: Write failing tests for `parse_feed_headlines`**

Create `plnd_data/src/clients/news.rs` with only the tests:

```rust
// plnd_data/src/clients/news.rs

use serde::{Deserialize, Serialize};
use crate::clients::dtos::Location;
use crate::clients::error::ExternalClientError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsHeadline {
    pub title: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewsQuery {
    pub location: Location,
    pub feed_url: Option<String>,
    pub limit: usize,
}

pub fn parse_feed_headlines(_content: &[u8], _limit: usize) -> Result<Vec<NewsHeadline>, String> {
    todo!("implement")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_returns_up_to_limit() {
        let rss = br#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Headline One</title></item>
  <item><title>Headline Two</title></item>
  <item><title>Headline Three</title></item>
  <item><title>Headline Four - should be excluded</title></item>
</channel></rss>"#;
        let result = parse_feed_headlines(rss, 3).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].title, "Headline One");
        assert_eq!(result[2].title, "Headline Three");
    }

    #[test]
    fn parse_empty_feed_returns_empty_vec() {
        let rss = br#"<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>"#;
        let result = parse_feed_headlines(rss, 3).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_fewer_than_limit() {
        let rss = br#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Only One</title></item>
</channel></rss>"#;
        let result = parse_feed_headlines(rss, 3).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Only One");
    }

    #[test]
    fn parse_invalid_bytes_returns_err() {
        let result = parse_feed_headlines(b"not xml at all %%%", 3);
        assert!(result.is_err());
    }
}
```

- [ ] **Step 2: Add `pub mod news;` to mod.rs**

In `plnd_data/src/clients/mod.rs`, add after `pub mod weather;`:

```rust
pub mod news;
```

- [ ] **Step 3: Run tests and confirm they panic**

```bash
cargo test -p plnd_data news 2>&1 | head -20
```

Expected: tests fail with `not yet implemented`.

- [ ] **Step 4: Implement `parse_feed_headlines` and add the `NewsProvider` trait**

Replace `plnd_data/src/clients/news.rs` with the full implementation:

```rust
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::clients::dtos::Location;
use crate::clients::error::ExternalClientError;

// ── Public types ──────────────────────────────────────────────────────────────

/// A single news headline returned by a `NewsProvider`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsHeadline {
    pub title: String,
    /// Link to the full article, if present in the feed entry.
    pub url: Option<String>,
}

/// Parameters for a news headlines request.
#[derive(Debug, Clone)]
pub struct NewsQuery {
    /// User's location — used by implementations for region-based source selection.
    pub location: Location,
    /// Per-request feed URL override. `None` means use the provider's default.
    pub feed_url: Option<String>,
    /// Maximum number of headlines to return.
    pub limit: usize,
}

/// Trait for fetching news headlines.
#[async_trait]
pub trait NewsProvider: Send + Sync {
    async fn headlines(&self, query: NewsQuery) -> Result<Vec<NewsHeadline>, ExternalClientError>;
}

// ── Pure helper ───────────────────────────────────────────────────────────────

/// Parse RSS/Atom bytes into `NewsHeadline` items, capped at `limit`.
pub fn parse_feed_headlines(content: &[u8], limit: usize) -> Result<Vec<NewsHeadline>, String> {
    use feed_rs::parser;
    let feed = parser::parse(content).map_err(|e| e.to_string())?;
    let headlines = feed
        .entries
        .iter()
        .filter_map(|e| {
            let title = e.title.as_ref().map(|t| t.content.clone())?;
            let url = e.links.first().map(|l| l.href.clone());
            Some(NewsHeadline { title, url })
        })
        .take(limit)
        .collect();
    Ok(headlines)
}

// ── RssFeedProvider ───────────────────────────────────────────────────────────

/// Fetches and parses an RSS/Atom feed from a configurable URL.
pub struct RssFeedProvider {
    http: reqwest::Client,
    default_feed_url: String,
}

impl RssFeedProvider {
    /// `default_feed_url` is used when `NewsQuery.feed_url` is `None`.
    /// Pass an empty string to disable news by default.
    pub fn new(default_feed_url: &str) -> Self {
        Self {
            http: super::build_http_client(),
            default_feed_url: default_feed_url.to_string(),
        }
    }
}

#[async_trait]
impl NewsProvider for RssFeedProvider {
    async fn headlines(&self, query: NewsQuery) -> Result<Vec<NewsHeadline>, ExternalClientError> {
        let feed_url = query
            .feed_url
            .as_deref()
            .unwrap_or(&self.default_feed_url);

        if feed_url.is_empty() {
            return Ok(vec![]);
        }

        let bytes = self
            .http
            .get(feed_url)
            .send()
            .await?
            .bytes()
            .await
            .map_err(|e| ExternalClientError::HttpError(e.to_string()))?;

        parse_feed_headlines(&bytes, query.limit)
            .map_err(|e| ExternalClientError::ResponseParseError(e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_returns_up_to_limit() {
        let rss = br#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Headline One</title></item>
  <item><title>Headline Two</title></item>
  <item><title>Headline Three</title></item>
  <item><title>Headline Four - should be excluded</title></item>
</channel></rss>"#;
        let result = parse_feed_headlines(rss, 3).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].title, "Headline One");
        assert_eq!(result[2].title, "Headline Three");
    }

    #[test]
    fn parse_empty_feed_returns_empty_vec() {
        let rss = br#"<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>"#;
        let result = parse_feed_headlines(rss, 3).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_fewer_than_limit() {
        let rss = br#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Only One</title></item>
</channel></rss>"#;
        let result = parse_feed_headlines(rss, 3).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Only One");
    }

    #[test]
    fn parse_invalid_bytes_returns_err() {
        let result = parse_feed_headlines(b"not xml at all %%%", 3);
        assert!(result.is_err());
    }
}
```

- [ ] **Step 5: Run tests and confirm they pass**

```bash
cargo test -p plnd_data news 2>&1
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add plnd_data/src/clients/news.rs plnd_data/src/clients/mod.rs
git commit -m "feat(plnd_data): add NewsProvider trait, NewsHeadline, NewsQuery, RssFeedProvider, parse_feed_headlines"
```

---

## Task 5: Update plnd_data mod.rs re-exports

**Files:**
- Modify: `plnd_data/src/clients/mod.rs`

- [ ] **Step 1: Add re-exports for new types**

In `plnd_data/src/clients/mod.rs`, add after the existing `pub use` lines:

```rust
pub use dtos::Location;
pub use news::{NewsHeadline, NewsProvider, NewsQuery, RssFeedProvider};
pub use weather::{OpenMeteoProvider, WeatherData, WeatherProvider};
```

- [ ] **Step 2: Verify plnd_data compiles cleanly**

```bash
cargo build -p plnd_data 2>&1
```

Expected: compiles with no errors or warnings about unused imports.

- [ ] **Step 3: Commit**

```bash
git add plnd_data/src/clients/mod.rs
git commit -m "chore(plnd_data): re-export WeatherProvider, NewsProvider, and Location from clients mod"
```

---

## Task 6: Refactor BriefingState to use provider traits

**Files:**
- Modify: `plnd_api/src/briefing.rs`

`BriefingState` currently holds `http: reqwest::Client`, `weather_latitude: f64`, `weather_longitude: f64`, `news_feed_url: String`, plus the two Moka caches. We replace the raw config + client fields with provider trait objects. The caches stay because they are an API-layer concern (TTL, shared-user policy).

`WeatherCacheEntry` was the cache value type; it is replaced by `plnd_data::clients::WeatherData`. The `WeatherCacheEntry` struct is deleted entirely.

- [ ] **Step 1: Write failing test for new BriefingState::new signature**

Replace `plnd_api/src/briefing.rs` entirely:

```rust
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
```

- [ ] **Step 2: Run tests — expect compile errors in plnd_api (references to old fields)**

```bash
cargo build -p plnd_api 2>&1 | head -40
```

Expected: compile errors referencing `weather_latitude`, `weather_longitude`, `news_feed_url`, `http`, `WeatherCacheEntry`. These are addressed in Tasks 8 and 9.

- [ ] **Step 3: Confirm the briefing.rs unit test itself passes in isolation**

```bash
cargo test -p plnd_api briefing_state_constructs 2>&1
```

Expected: This may still fail due to cross-module compile errors — that's fine. Note any errors; they'll be resolved in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add plnd_api/src/briefing.rs
git commit -m "refactor(plnd_api): BriefingState uses WeatherProvider/NewsProvider trait objects"
```

---

## Task 7: Update routes/briefing.rs

**Files:**
- Modify: `plnd_api/src/routes/briefing.rs`

This is the largest change. The route handlers gain a `?loc=<lat>,<lon>` query parameter. Inline Open-Meteo HTTP logic and `feed_rs` parsing move to the providers. The existing pure-function unit tests for `weather_code_to_condition` and `parse_feed_headlines` are deleted (they now live in plnd_data). New response DTOs `WeatherResponse` and `NewsHeadlineResponse` are defined here with `utoipa::ToSchema`.

Replace `plnd_api/src/routes/briefing.rs` entirely:

```rust
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
    Some(Location { latitude, longitude })
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
        Self { title: h.title, url: h.url }
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

    state.briefing.weather_cache.insert(cache_key, data.clone()).await;
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

    let data = state
        .briefing
        .news
        .headlines(query)
        .await
        .map_err(|e| {
            eprintln!("news fetch error: {e}");
            StatusCode::SERVICE_UNAVAILABLE
        })?;

    state.briefing.news_cache.insert(cache_key, data.clone()).await;
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
    fn round_location_1dp() {
        let loc = round_location(Location { latitude: 51.5074, longitude: -0.1278 });
        assert!((loc.latitude - 51.5).abs() < 1e-9);
        assert!((loc.longitude - (-0.1)).abs() < 1e-9);
    }

    #[test]
    fn round_location_rounds_up() {
        let loc = round_location(Location { latitude: 51.55, longitude: 0.0 });
        assert!((loc.latitude - 51.6).abs() < 1e-9);
    }
}
```

- [ ] **Step 2: Run route tests**

```bash
cargo test -p plnd_api routes::briefing 2>&1
```

Expected: 6 tests pass (parse_loc and round_location tests). The crate may still fail to compile fully due to remaining references in `main.rs` and `openapi.rs` — that is expected and addressed in the next two tasks.

- [ ] **Step 3: Commit**

```bash
git add plnd_api/src/routes/briefing.rs
git commit -m "refactor(plnd_api): briefing routes use provider traits; add ?loc= query param; 400 on missing/malformed"
```

---

## Task 8: Update main.rs and openapi.rs

**Files:**
- Modify: `plnd_api/src/main.rs`
- Modify: `plnd_api/src/openapi.rs`

- [ ] **Step 1: Update main.rs**

In `plnd_api/src/main.rs`, make these changes:

**Add imports** (replace the existing briefing import line):
```rust
use plnd_api::briefing::BriefingState;
use plnd_data::clients::{OpenMeteoProvider, RssFeedProvider};
```

**Replace the `briefing` construction block** (lines ~141-157, which currently read `let briefing = BriefingState::new(config.external_providers.weather_latitude, ...)`):

```rust
    let weather_provider = Arc::new(OpenMeteoProvider::new());
    let news_provider = Arc::new(RssFeedProvider::new(
        &config.external_providers.news_feed_url,
    ));
    let briefing = BriefingState::new(weather_provider, news_provider);
    if config.external_providers.news_feed_url.is_empty() {
        println!("  Briefing news feed: disabled (news_feed_url not set)");
    } else {
        println!(
            "  Briefing news feed: {}",
            config.external_providers.news_feed_url
        );
    }
```

Remove the `println!("  Briefing weather location: ...")` line (no longer meaningful — location comes from each request).

- [ ] **Step 2: Update openapi.rs**

In `plnd_api/src/openapi.rs`, make these exact changes:

Replace line 4:
```rust
use crate::briefing::WeatherCacheEntry;
```
With:
```rust
// (deleted — WeatherCacheEntry no longer exists)
```
(i.e., delete the line entirely)

Replace line 7:
```rust
    briefing::{NewsResponse, YesterdayResponse},
```
With:
```rust
    briefing::{NewsHeadlineResponse, NewsResponse, WeatherResponse, YesterdayResponse},
```

Replace line 62 in the `components(schemas(...))`  block:
```rust
        WeatherCacheEntry,
```
With:
```rust
        WeatherResponse,
        NewsHeadlineResponse,
```

- [ ] **Step 3: Verify the crate compiles**

```bash
just verify-build
```

Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add plnd_api/src/main.rs plnd_api/src/openapi.rs
git commit -m "refactor(plnd_api): inject OpenMeteoProvider and RssFeedProvider into BriefingState"
```

---

## Task 9: Remove stale config fields and feed-rs from plnd_api

**Files:**
- Modify: `plnd_api/src/config/settings.rs`
- Modify: `plnd_api/Cargo.toml`

- [ ] **Step 1: Remove weather_latitude and weather_longitude from ExternalProvidersConfig**

In `plnd_api/src/config/settings.rs`, remove these fields from `ExternalProvidersConfig`:

```rust
    // DELETE these two fields:
    /// WGS-84 latitude for Open-Meteo weather proxy (e.g. 51.5074 for London).
    #[serde(default = "default_weather_latitude")]
    pub weather_latitude: f64,
    /// WGS-84 longitude for Open-Meteo weather proxy (e.g. -0.1278 for London).
    #[serde(default = "default_weather_longitude")]
    pub weather_longitude: f64,
```

Also remove the two default functions:
```rust
// DELETE:
fn default_weather_latitude() -> f64 {
    51.5074
}
fn default_weather_longitude() -> f64 {
    -0.1278
}
```

- [ ] **Step 2: Remove feed-rs from plnd_api/Cargo.toml**

In `plnd_api/Cargo.toml`, remove:
```toml
feed-rs      = "2"
```

- [ ] **Step 3: Verify build and tests pass**

```bash
just verify-build && cargo test -p plnd_api 2>&1
```

Expected: clean build, all plnd_api unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add plnd_api/src/config/settings.rs plnd_api/Cargo.toml
git commit -m "chore(plnd_api): remove stale weather_latitude/longitude config and feed-rs dependency"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run full CI test suite**

```bash
just test-ci
```

Expected: all Rust tests (nextest) + Angular headless tests pass.

- [ ] **Step 2: Run server startup test**

```bash
just test-run-server
```

Expected: server starts cleanly, no panic, exits after 15s.

- [ ] **Step 3: Run full quality gate**

```bash
just verify
```

Expected: fmt, clippy, deny, machete, ts-lint, ts-deps, build, and tests all pass.

- [ ] **Step 4: Open PR**

```bash
git push -u origin HEAD
gh pr create \
  --title "refactor: extract WeatherProvider and NewsProvider to plnd_data (#161)" \
  --body "$(cat <<'EOF'
## Summary

- Extracts weather and news fetching from inline route handler code into `WeatherProvider` / `NewsProvider` traits in `plnd_data/src/clients/`
- `OpenMeteoProvider` and `RssFeedProvider` implement the traits; `BriefingState` holds `Arc<dyn WeatherProvider>` + `Arc<dyn NewsProvider>`
- `/briefing/weather` and `/briefing/news` now require a `?loc=<lat>,<lon>` query param; missing/malformed returns 400
- Cache keys round coordinates to 1 decimal place (~11 km grid) for better hit rates
- Removes `weather_latitude`/`weather_longitude` from `ExternalProvidersConfig` (location now per-request)
- Moves `feed-rs` dependency from `plnd_api` to `plnd_data`

Closes #161
References #158

## Test plan
- [ ] `just verify` passes cleanly
- [ ] `GET /briefing/weather?loc=51.5,-0.1` returns weather JSON
- [ ] `GET /briefing/weather` (no param) returns 400
- [ ] `GET /briefing/weather?loc=bad` returns 400
- [ ] `GET /briefing/news?loc=51.5,-0.1` returns headlines array

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
