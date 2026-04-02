# Design: Extract WeatherProvider and NewsProvider to plnd_data

**Date:** 2026-04-02
**Related issues:** Closes sub-issue; references #158

---

## Context

The morning briefing feature (merged #156) added weather and news fetching inline inside
`plnd_api/src/routes/briefing.rs` — raw `reqwest` HTTP calls and `feed_rs` parsing living
directly in the route handler. This violates the established pattern in `plnd_data/src/clients/`
where external HTTP providers are defined as trait + impl structs (e.g. `UsdaFdcClient`,
`TheMealDbClient`).

This design extracts weather and news into proper `WeatherProvider` / `NewsProvider` traits
with `OpenMeteoProvider` and `RssFeedProvider` implementations in `plnd_data`, making them
injectable, mockable, and ready for Phase 3 agent tooling. This also cleans up issue #158
(DB layer migration) so that it becomes a pure DB-only move with no external client concerns.

A separate follow-up sub-issue will rename `plnd_data/src/clients/` → `providers/` for
semantic consistency across the codebase.

---

## Architecture

### New files

| File | Purpose |
|------|---------|
| `plnd_data/src/clients/weather.rs` | `WeatherProvider` trait, `WeatherData` DTO, `OpenMeteoProvider` impl |
| `plnd_data/src/clients/news.rs` | `NewsProvider` trait, `NewsHeadline` DTO, `NewsQuery` struct, `RssFeedProvider` impl |

### Modified files

| File | Change |
|------|--------|
| `plnd_data/src/clients/dtos.rs` | Add shared `Location { latitude: f64, longitude: f64 }` struct |
| `plnd_data/src/clients/mod.rs` | Re-export new traits and types |
| `plnd_data/Cargo.toml` | Add `feed_rs`; add `reqwest` if not already present |
| `plnd_api/Cargo.toml` | Remove `feed_rs` (logic moves to `plnd_data`) |
| `plnd_api/src/config/settings.rs` | Remove `weather_latitude` and `weather_longitude` from `ExternalProvidersConfig` (no longer needed; lat/lon comes from `?loc=` at request time) |
| `plnd_api/src/briefing.rs` | Replace raw config fields with `Arc<dyn WeatherProvider>` + `Arc<dyn NewsProvider>`; Moka caches stay here |
| `plnd_api/src/routes/briefing.rs` | Parse `?loc=` query param; delegate to providers; move inline logic and tests to provider files |
| `plnd_api/src/main.rs` | Construct `OpenMeteoProvider` + `RssFeedProvider`, inject into `BriefingState` |

---

## Type Definitions

```rust
// plnd_data/src/clients/dtos.rs (addition)
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
}

// plnd_data/src/clients/weather.rs
pub struct WeatherData {
    pub temperature_c: f64,
    pub condition: String,
    pub high_c: f64,
    pub low_c: f64,
    pub precipitation_mm: f64,
}

#[async_trait]
pub trait WeatherProvider: Send + Sync {
    async fn current(&self, location: Location) -> Result<WeatherData, ExternalClientError>;
}

pub struct OpenMeteoProvider {
    http: reqwest::Client,
    // lat/lon passed at call time, not construction time
}

// plnd_data/src/clients/news.rs
pub struct NewsHeadline {
    pub title: String,
    pub url: String,
}

pub struct NewsQuery {
    pub location: Location,          // region-based source selection
    pub feed_url: Option<String>,    // user-specified feed override (None = use default)
    pub limit: usize,
}

#[async_trait]
pub trait NewsProvider: Send + Sync {
    async fn headlines(&self, query: NewsQuery) -> Result<Vec<NewsHeadline>, ExternalClientError>;
}

pub struct RssFeedProvider {
    http: reqwest::Client,
    default_feed_url: String,        // falls back to this when query.feed_url is None
}
```

---

## Data Flow

### Weather endpoint

```
GET /briefing/weather?loc=<lat>,<lon>
  → parse ?loc= query param
  → 400 Bad Request if missing or malformed
  → round lat/lon to 1 decimal place
  → check BriefingState weather_cache (key: "{lat:.1},{lon:.1}")
    → hit  → return cached WeatherData
    → miss → OpenMeteoProvider::current(location) → store in cache
  → 503 Service Unavailable on provider failure
```

### News endpoint

```
GET /briefing/news?loc=<lat>,<lon>
  → parse ?loc= query param
  → round lat/lon to 1 decimal place
  → check BriefingState news_cache (key: "{lat:.1},{lon:.1}:{feed_url}")
    → hit  → return cached headlines
    → miss → RssFeedProvider::headlines(NewsQuery { location, feed_url: None, limit: 3 }) → cache
  → 503 on provider failure
```

**Cache key rounding:** `f64::round(coord * 10.0) / 10.0` before generating keys. Weather
does not change meaningfully within ~11 km, and coarser keys maximise cache hit rates across
nearby users.

---

## BriefingState Refactor

```rust
// plnd_api/src/briefing.rs
pub struct BriefingState {
    pub weather: Arc<dyn WeatherProvider>,
    pub news: Arc<dyn NewsProvider>,
    weather_cache: Cache<String, WeatherData>,
    news_cache: Cache<String, Vec<NewsHeadline>>,
}

impl BriefingState {
    pub fn new(weather: Arc<dyn WeatherProvider>, news: Arc<dyn NewsProvider>) -> Self { ... }
}
```

Wired in `main.rs`:

```rust
let weather_provider = Arc::new(OpenMeteoProvider::new());
let news_provider = Arc::new(RssFeedProvider::new(&config.external_providers.news_feed_url));
let briefing = BriefingState::new(weather_provider, news_provider);
```

The `weather_latitude`, `weather_longitude`, and `news_feed_url` fields are removed from
`ExternalProvidersConfig` usage in `BriefingState::new()` — lat/lon now come from the
`?loc=` query param at request time; `news_feed_url` moves to `RssFeedProvider` as its
default.

---

## Error Handling

| Scenario | Response |
|----------|----------|
| `?loc=` missing | `400 Bad Request` |
| `?loc=` malformed (not parseable as `f64,f64`) | `400 Bad Request` |
| Provider HTTP failure or parse error | `503 Service Unavailable` |

---

## Testing

- `weather_code_to_condition()` unit tests → move from `routes/briefing.rs` → `weather.rs`
- `parse_feed_headlines()` unit tests → move from `routes/briefing.rs` → `news.rs`
- `OpenMeteoProvider` and `RssFeedProvider` get HTTP-mocked unit tests (same pattern as `usda_fdc.rs`)
- Traits are mockable for route handler tests via `Arc<dyn WeatherProvider>`

---

## Future Considerations

- **Location availability:** The `?loc=` param will be populated by the frontend using
  browser geolocation → user preference fallback → omit weather entirely if unavailable.
  The API does not need to handle fallback; it simply requires the param or returns 400.
- **Per-user news feeds:** `NewsQuery.feed_url` is already `Option<String>` to allow
  user-specified overrides once user preferences are wired through.
- **Module rename:** `plnd_data/src/clients/` → `providers/` is a separate deferred issue.
