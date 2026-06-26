# Refactor: Decompose `plnd_api::main()`

**Date:** 2026-06-26
**Branch:** `worktree-refactor+main-decomposition`
**Status:** Approved (design)

## Problem

`plnd_api/src/main.rs` is a ~630-line "fat main". A single function performs
configuration loading, OTEL provider init, tracing-subscriber construction,
database connection, auth-service wiring, external-provider construction,
background catalog-seed spawning, `AppState` assembly, ~200 lines of route
registration, middleware stacking, and server startup. The four
`build_*_providers` helpers are stranded at the bottom of the binary.

Because `main.rs` is the only place that touches routing, middleware,
telemetry, API docs, rate limiting, and every provider type at once, its import
header is enormous (~45 `use` lines). This fails separation of concerns and
makes the entry point hard to read, hard to test, and hard to change.

## Goals

- Shrink `main()` to a short orchestration sequence (~30 lines).
- Give each wiring concern its own focused, binary-local module so imports
  follow the code that needs them.
- Replace the repeated `match … { Err(e) => { log; process::exit(1) } }` startup
  pattern with `?`-propagation.

## Non-goals

- **No behavior change.** Same routes, same paths, same middleware ordering,
  same logging output, same `#[cfg(debug_assertions)]` gating, same background
  seed semantics.
- No changes to the public `lib.rs` surface — wiring modules stay binary-local
  (as `telemetry.rs` already is).
- No new workspace dependencies (no `anyhow`).
- No unrelated refactoring of routes, handlers, or providers themselves.

## Design

### Module layout

All new modules are **binary-local** — declared with `mod` in `main.rs`, not in
`lib.rs` — matching the existing `telemetry.rs` precedent (binary-local yet
unit-tested). Public/reusable domain code stays in `lib.rs`.

```
plnd_api/src/
  main.rs        # orchestration only (~30 lines)
  telemetry.rs   # (existing) + new init_subscriber()
  providers.rs   # (new) external-provider construction
  startup.rs     # (new) AppState assembly + seed spawn
  router.rs      # (new) route table + middleware + docs
```

### `main.rs` (target)

```rust
mod telemetry;
mod providers;
mod startup;
mod router;

use plnd_api::config;
use std::net::SocketAddr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = match config::load_config() {
        Ok(c) => c,
        Err(e) => {
            // Subscriber not yet initialized — eprintln is the only option here.
            eprintln!("Failed to load configuration: {e}");
            std::process::exit(1);
        }
    };

    let otel = telemetry::init_providers(config.otel.endpoint.as_deref())?;
    telemetry::init_subscriber(&config.logging, otel.as_ref());

    let state = startup::build_state(&config).await?;
    let cors = router::cors_layer(&config.auth.frontend_origin)?;
    let app = router::build(state, cors);

    let listener = tokio::net::TcpListener::bind(&config.api.base_url).await?;
    tracing::info!(addr = %listener.local_addr()?, "API server listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    if let Some(providers) = otel {
        telemetry::shutdown_providers(providers);
    }
    Ok(())
}
```

### `telemetry.rs` (add `init_subscriber`)

Moves the 4-arm `match (pretty_print, otel)` subscriber builder out of `main`.

```rust
pub fn init_subscriber(
    logging: &crate::config::settings::LoggingConfig,
    otel: Option<&TelemetryProviders>,
);
```

Pulls these imports out of `main.rs`: `tracing_subscriber::{layer, util}`,
`opentelemetry_appender_tracing`, `tracing_opentelemetry`,
`opentelemetry::trace::TracerProvider`.

### `providers.rs` (new)

Owns all external-provider construction and provider-readiness logging. Houses
the four existing `build_*` fns (`build_briefing_providers`,
`build_nutrition_providers`, `build_recipe_providers`, `build_brand_normalizer`)
plus the inline USDA / Open Food Facts / TheMealDB construction.

Exposes one entry point returning everything downstream wiring needs:

```rust
pub struct Providers {
    pub search: plnd_data::search::ProviderSearchService,
    pub briefing: crate::briefing::BriefingState,
    pub brand_normalizer: std::sync::Arc<dyn plnd_agent::BrandNormalizer>,
    /// Recipe providers reused by the background catalog seed task.
    pub catalog_recipe: Vec<Arc<dyn plnd_data::providers::RecipeProvider>>,
}

pub fn build(
    external: &crate::config::settings::ExternalProvidersConfig,
    llm: &plnd_agent::LlmConfig,
) -> Providers;
```

Pulls these imports out of `main.rs`: all `plnd_data::providers::*`, the
`#[cfg(debug_assertions)]` fixture providers, `plnd_data::cache::SearchCache`,
`plnd_data::search::ProviderSearchService`.

**Retained `process::exit(1)`:** the fixture-load failure paths inside the
`build_*` fns keep their existing `unwrap_or_else(|e| … exit(1))` form. These are
debug-only fatal paths; converting them to `Result` would ripple through
`build`'s signature for no behavioral gain. This is the one deliberate exception
to `?`-propagation.

### `startup.rs` (new)

Owns `AppState` assembly. Builds repositories, JWT/JWKS/session services, the
CORS-origin parse, both rate limiters, the `AgentService`, calls
`providers::build`, spawns the background catalog seed, and assembles the
`Arc<AppState>`. Also emits the "configuration loaded" / "database connected" /
"OIDC configured" info logs.

```rust
pub async fn build_state(
    config: &crate::config::settings::Settings,
) -> Result<Arc<crate::state::AppState>, Box<dyn std::error::Error + Send + Sync>>;
```

The background seed `tokio::spawn` moves here verbatim (still uses
`config.database.url` + the recipe providers from `Providers::catalog_recipe`).
CORS construction is **not** here — it lives in `router.rs` (HTTP concern).

Pulls these imports out of `main.rs`: `plnd_agent::AgentService`,
`plnd_data::Repositories`, `governor::{Quota, RateLimiter}`, auth services,
`plnd_seed`.

### `router.rs` (new)

Owns HTTP wiring: the `protected` and `public` route tables, the
`#[cfg(debug_assertions)]` `/test/seed` route, the auth middleware layer, CORS,
the trace/request-id/metrics layers, and the Swagger/Scalar doc mounts.

```rust
/// Builds the `CorsLayer` from the configured frontend origin.
/// Returns `Err` if the origin string is not a valid header value
/// (replaces the previous `.expect(...)` panic with `?`-propagation).
pub fn cors_layer(
    frontend_origin: &str,
) -> Result<tower_http::cors::CorsLayer, Box<dyn std::error::Error + Send + Sync>>;

/// Builds the full application router: route tables, auth middleware, the
/// trace/request-id/metrics layers, the CORS layer, and the Swagger/Scalar docs.
pub fn build(state: Arc<crate::state::AppState>, cors: tower_http::cors::CorsLayer) -> axum::Router;
```

**CORS decision (explicit):** `router::build` takes `(state, cors)`. The
`CorsLayer` — including the `frontend_origin` parse — is built by
`router::cors_layer`, called from `main` and handed in. This keeps all HTTP-layer
construction in `router.rs`, takes only the config *string* as input (no `config`
or `AppState` field dependency), and turns the origin-parse panic into a
propagated error.

Pulls these imports out of `main.rs`: `axum::routing::*`, `tower_http::*`,
`utoipa*`, `plnd_api::middleware::*`, every `routes::*` handler import.

### Error handling

`main()` returns `Result<(), Box<dyn std::error::Error + Send + Sync>>`.

- `init_providers`, `build_state`, `bind`, `local_addr`, and `serve` all
  propagate with `?`.
- The single pre-subscriber `eprintln!` + `exit(1)` survives only for
  `load_config` (it fails before any subscriber exists, so structured logging is
  unavailable).
- Fixture-load fatal paths inside `providers.rs` retain `exit(1)` (see above).

## Testing

- Existing `telemetry.rs` unit tests are unaffected.
- `router::build` becomes independently constructible — add a binary-target unit
  test that builds the router and asserts it constructs without panic (and,
  cheaply, that a representative route resolves). Mechanical route-move
  correctness is otherwise covered by the existing e2e suite.
- Full safety net: `just verify` (quality + build + unit + e2e). The refactor is
  behavior-preserving, so a green `verify` is the acceptance signal.

## Risks

- **Route ordering / middleware ordering drift.** Mitigation: move route and
  layer code verbatim; diff the registration block against the original; rely on
  e2e to catch any path regressions.
- **`#[cfg(debug_assertions)]` gating moved across module boundaries.** The
  test-seed route and fixture providers must keep identical gating. Mitigation:
  carry the `#[cfg]` attributes with the code they guard.
