# `plnd_api::main()` Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the ~630-line `plnd_api/src/main.rs` into four focused binary-local modules so `main()` becomes a ~30-line orchestration sequence with `?`-propagation.

**Architecture:** Extract telemetry-subscriber init, external-provider construction, `AppState` assembly, and HTTP routing into `telemetry.rs` (extend), `providers.rs`, `startup.rs`, and `router.rs` respectively. Each module is binary-local (declared with `mod` in `main.rs`, not exported from `lib.rs`), matching the existing `telemetry.rs` precedent. The refactor is strictly behavior-preserving — code moves verbatim; only error-handling shape changes (`match … process::exit` → `?`).

**Tech Stack:** Rust, axum 0.8, tower-http, tokio, OpenTelemetry, utoipa, governor.

## Global Constraints

- **Behavior-preserving:** identical routes, paths, middleware ordering, log output, `#[cfg(debug_assertions)]` gating, and background-seed semantics. Copied verbatim from spec.
- **No new workspace dependency** (no `anyhow`). Error type is `Box<dyn std::error::Error + Send + Sync>`.
- **Public `lib.rs` surface unchanged** — all new modules are binary-local.
- **Top-level config type is `plnd_api::config::settings::AppConfig`** (accessed via `config.api`, `config.logging`, `config.otel`, `config.database`, `config.auth`, `config.external_providers`, `config.llm`, `config.agent`).
- **Retained `process::exit(1)`:** the fixture-load fatal paths inside the `build_*` provider fns keep their `unwrap_or_else(|e| … exit(1))` form (debug-only fatals). This is the only deliberate non-`?` exit besides config-load.
- **Verification cadence:** each task ends with `just verify-build` (fast compile check) + commit. A final task runs the full `just verify`. Run `just fmt` before any `just verify*`. Never pipe `just verify` into anything.
- **Branch discipline:** work stays on this worktree branch; never commit to `main`. Use `git -C <worktree>` for git from outside the worktree.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `plnd_api/src/main.rs` | Orchestration only: load config → init telemetry → build state → build router → serve → shutdown | Rewrite (shrinks to ~30 lines) |
| `plnd_api/src/telemetry.rs` | OTEL providers (existing) + tracing-subscriber init | Extend |
| `plnd_api/src/providers.rs` | External-provider construction + readiness logging; `build() -> Providers` | Create |
| `plnd_api/src/startup.rs` | `AppState` assembly + background seed spawn; `build_state() -> Result<Arc<AppState>>` | Create |
| `plnd_api/src/router.rs` | Route tables, middleware, CORS, docs; `cors_layer()` + `build()` | Create |

Tasks are ordered bottom-up so the crate compiles after every task.

---

### Task 1: Extract `telemetry::init_subscriber`

Move the 4-arm tracing-subscriber `match` out of `main()` into `telemetry.rs`.

**Files:**
- Modify: `plnd_api/src/telemetry.rs` (add `init_subscriber`)
- Modify: `plnd_api/src/main.rs:70-104` (replace the match block + the `env_filter` closure with one call)

**Interfaces:**
- Consumes: `TelemetryProviders` (existing, in `telemetry.rs`), `plnd_api::config::settings::LoggingConfig`.
- Produces: `pub fn init_subscriber(logging: &crate::config::settings::LoggingConfig, otel: Option<&TelemetryProviders>)`

- [ ] **Step 1: Add `init_subscriber` to `telemetry.rs`**

Add these imports near the top of `telemetry.rs`:
```rust
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
```
Add the function (move the body verbatim from `main.rs:72-97`, parameterized):
```rust
/// Build and install the global tracing subscriber.
///
/// Each match arm produces a different concrete `Subscriber` type — all valid.
/// When `otel` is `Some`, OTLP trace + log layers are attached; otherwise a
/// plain fmt subscriber is installed (stdout-only mode).
pub fn init_subscriber(
    logging: &crate::config::settings::LoggingConfig,
    otel: Option<&TelemetryProviders>,
) {
    let env_filter = || tracing_subscriber::EnvFilter::new(&logging.level);

    match (logging.pretty_print, otel) {
        (true, Some(p)) => tracing_subscriber::registry()
            .with(env_filter())
            .with(tracing_subscriber::fmt::layer().pretty().with_target(true))
            .with(tracing_opentelemetry::layer().with_tracer(p.tracer_provider.tracer("plnd_api")))
            .with(OpenTelemetryTracingBridge::new(&p.logger_provider))
            .init(),
        (false, Some(p)) => tracing_subscriber::registry()
            .with(env_filter())
            .with(tracing_subscriber::fmt::layer().json().with_target(true))
            .with(tracing_opentelemetry::layer().with_tracer(p.tracer_provider.tracer("plnd_api")))
            .with(OpenTelemetryTracingBridge::new(&p.logger_provider))
            .init(),
        (true, None) => tracing_subscriber::fmt()
            .with_env_filter(env_filter())
            .with_target(true)
            .pretty()
            .init(),
        (false, None) => tracing_subscriber::fmt()
            .with_env_filter(env_filter())
            .with_target(true)
            .json()
            .init(),
    }
}
```

- [ ] **Step 2: Replace the block in `main.rs`**

Delete `main.rs` lines 70-97 (the `env_filter` closure + the match) and replace with:
```rust
    telemetry::init_subscriber(&config.logging, otel_providers.as_ref());
```
Remove the now-unused `use` lines from `main.rs`: `opentelemetry::trace::TracerProvider`, `opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge`, `tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt}`.

- [ ] **Step 3: Format + compile-check**

Run: `just fmt && just verify-build`
Expected: compiles clean, no unused-import warnings for the three removed `use`s.

- [ ] **Step 4: Commit**

```bash
git add plnd_api/src/telemetry.rs plnd_api/src/main.rs
git commit -m "refactor(plnd_api): extract telemetry::init_subscriber from main"
```

---

### Task 2: Extract `providers.rs`

Move the four `build_*` provider fns and the inline USDA/OFF/MealDB construction + readiness logging into a new `providers` module exposing one `build()` entry point.

**Files:**
- Create: `plnd_api/src/providers.rs`
- Modify: `plnd_api/src/main.rs` (add `mod providers;`; replace lines 147-218 region with a `providers::build(...)` call; remove the four `build_*` fns at lines 500-632)

**Interfaces:**
- Consumes: `plnd_api::config::settings::ExternalProvidersConfig`, `plnd_agent::LlmConfig`.
- Produces:
```rust
pub struct Providers {
    pub search: plnd_data::search::ProviderSearchService,
    pub briefing: crate::briefing::BriefingState,
    pub brand_normalizer: std::sync::Arc<dyn plnd_agent::BrandNormalizer>,
    /// Recipe providers reused by the background catalog seed task (Task 3).
    pub catalog_recipe: Vec<std::sync::Arc<dyn plnd_data::providers::RecipeProvider>>,
}
pub fn build(
    external: &crate::config::settings::ExternalProvidersConfig,
    llm: &plnd_agent::LlmConfig,
) -> Providers;
```

- [ ] **Step 1: Create `providers.rs` with the moved code**

Create `plnd_api/src/providers.rs`. Move verbatim from `main.rs`:
- the four free fns `build_briefing_providers`, `build_nutrition_providers`, `build_recipe_providers`, `build_brand_normalizer` (currently `main.rs:507-632`) — make them private (`fn`, drop `pub`-equivalent free status; they were already private free fns).
- the imports they need: the `#[cfg(debug_assertions)]` fixture providers and the live providers from `plnd_data::providers`, `std::sync::Arc`.

Add the module header imports:
```rust
use std::sync::Arc;
use plnd_data::cache::SearchCache;
#[cfg(debug_assertions)]
use plnd_data::providers::{
    FixtureNewsProvider, FixtureNutritionProvider, FixtureWeatherProvider, TheMealDbFixtureProvider,
};
use plnd_data::providers::{
    NewsProvider, OpenFoodFactsProvider, OpenMeteoProvider, RssFeedProvider, TheMealDbProvider,
    UsdaFdcProvider, WeatherProvider,
};
use plnd_data::search::ProviderSearchService;
use crate::briefing::BriefingState;
```

Add the `Providers` struct (signature above), then the `build` fn that contains the construction logic moved verbatim from `main.rs:147-218`:
```rust
pub fn build(
    external: &crate::config::settings::ExternalProvidersConfig,
    llm: &plnd_agent::LlmConfig,
) -> Providers {
    // Construct external providers (moved verbatim from old main.rs:148-174).
    let nutrition_usda: Arc<dyn plnd_data::providers::NutritionProvider> =
        Arc::new(UsdaFdcProvider::new(&external.usda_fdc_api_key));
    let off_basic_auth = if external.off_basic_auth_user.is_empty() {
        None
    } else {
        Some((
            external.off_basic_auth_user.clone(),
            external.off_basic_auth_password.clone(),
        ))
    };
    let nutrition_off: Arc<dyn plnd_data::providers::NutritionProvider> =
        Arc::new(OpenFoodFactsProvider::new(&external.off_base_url, off_basic_auth));
    let recipe_mdb = Arc::new(TheMealDbProvider::new(&external.themealdb_api_key));

    if external.usda_fdc_api_key.is_empty() {
        tracing::warn!("USDA FDC provider: no API key set (will return ConfigurationError at runtime)");
    } else {
        tracing::info!("USDA FDC provider: ready");
    }
    tracing::info!(base_url = %external.off_base_url, "Open Food Facts provider: ready");
    tracing::info!("TheMealDB provider: ready");

    let catalog_nutrition =
        build_nutrition_providers(external, nutrition_usda.clone(), nutrition_off.clone());
    let catalog_recipe = build_recipe_providers(external, recipe_mdb.clone());

    let search_cache = SearchCache::new(external.search_cache_ttl_hours);
    let search = ProviderSearchService::new(
        catalog_nutrition,
        catalog_recipe.clone(),
        vec![],
        search_cache,
    );

    let (weather_provider, news_provider) = build_briefing_providers(external);
    let briefing = BriefingState::new(weather_provider, news_provider);
    if external.fixture_path.is_none() {
        if external.news_feed_urls.is_empty() {
            tracing::warn!("briefing news feed disabled (news_feed_urls not set)");
        } else {
            tracing::info!(
                feed_count = external.news_feed_urls.len(),
                "briefing news feeds configured"
            );
        }
    }

    let brand_normalizer = build_brand_normalizer(external, llm);

    Providers { search, briefing, brand_normalizer, catalog_recipe }
}
```
Note: the four moved `build_*` fns drop their `plnd_api::config::settings::` path prefix in favor of `crate::config::settings::`, and `plnd_api::...` → `crate::...` / unqualified since they now live inside the crate. Update each signature's `external: &plnd_api::config::settings::ExternalProvidersConfig` → `external: &crate::config::settings::ExternalProvidersConfig`.

- [ ] **Step 2: Wire `main.rs` to call `providers::build`**

Add `mod providers;` at the top of `main.rs` (after `mod telemetry;`).
Replace `main.rs:147-218` (the inline provider construction through the briefing-log block) — but **keep the seed spawn at 188-201 for now** (it moves in Task 3) — with:
```rust
    let providers = providers::build(&config.external_providers, &config.llm);
```
Then update the seed spawn (still in `main.rs`) to use `providers.catalog_recipe.clone()` instead of the old `catalog_recipe`, and update the `AppState` construction (lines 235-248) to use `providers.search`, `providers.briefing`, `providers.brand_normalizer`:
```rust
        provider_search: providers.search,
        briefing: providers.briefing,
        brand_normalizer: providers.brand_normalizer,
```
Delete the four `build_*` fns from the bottom of `main.rs` (old lines 500-632).
Remove now-unused provider imports from `main.rs`: the `plnd_data::providers::*`, the `#[cfg(debug_assertions)]` fixtures, `plnd_data::cache::SearchCache`, `plnd_data::search::ProviderSearchService`, and the `build_brand_normalizer`-only bits. (`std::sync::Arc` is still needed for rate limiters until Task 3.)

- [ ] **Step 3: Format + compile-check**

Run: `just fmt && just verify-build`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add plnd_api/src/providers.rs plnd_api/src/main.rs
git commit -m "refactor(plnd_api): extract external-provider construction into providers module"
```

---

### Task 3: Extract `startup::build_state`

Move repositories, auth services, rate limiters, `AgentService`, the `providers::build` call, the background seed spawn, and `AppState` assembly into `startup.rs`.

**Files:**
- Create: `plnd_api/src/startup.rs`
- Modify: `plnd_api/src/main.rs` (add `mod startup;`; replace lines 99-248 region with one call)

**Interfaces:**
- Consumes: `providers::build` (Task 2), `crate::config::settings::AppConfig`, `crate::state::AppState`.
- Produces:
```rust
pub async fn build_state(
    config: &crate::config::settings::AppConfig,
) -> Result<std::sync::Arc<crate::state::AppState>, Box<dyn std::error::Error + Send + Sync>>;
```

- [ ] **Step 1: Create `startup.rs`**

Create `plnd_api/src/startup.rs`:
```rust
use std::num::NonZeroU32;
use std::sync::Arc;

use governor::{Quota, RateLimiter};

use crate::auth::{JwksCache, JwtService, SessionService};
use crate::providers;
use crate::state::AppState;

/// Build the shared `AppState`: repositories, auth services, rate limiters,
/// the agent service, external providers, and the background catalog seed.
///
/// Emits the configuration/database/OIDC startup logs. Returns `Err` on a
/// database-connection failure or an unparseable value; the caller exits.
pub async fn build_state(
    config: &crate::config::settings::AppConfig,
) -> Result<Arc<AppState>, Box<dyn std::error::Error + Send + Sync>> {
    tracing::info!(
        api_base_url = %config.api.base_url,
        log_level = %config.logging.level,
        otel_enabled = config.otel.endpoint.is_some(),
        "configuration loaded"
    );

    let repos = plnd_data::Repositories::new(
        &config.database.url,
        config.database.max_connections as u32,
    )
    .await?;
    tracing::info!("database connected and migrations applied");

    let jwt = JwtService::new(config.auth.jwt.secret.clone(), config.auth.jwt.jwt_expiration);

    // internal_issuer_url (Docker-internal host) for server-to-server JWKS fetch;
    // external issuer_url validates the token `iss` claim.
    let internal_issuer = if config.auth.oidc.internal_issuer_url.is_empty() {
        config.auth.oidc.issuer_url.clone()
    } else {
        config.auth.oidc.internal_issuer_url.clone()
    };
    let jwks = JwksCache::new(config.auth.oidc.issuer_url.clone(), internal_issuer);
    tracing::info!(
        issuer = %config.auth.oidc.issuer_url,
        client_id = %config.auth.oidc.client_id,
        "OIDC configured"
    );

    let providers = providers::build(&config.external_providers, &config.llm);

    // Seed catalog tables in the background so the server binds immediately.
    // Idempotent; failures are non-fatal warnings (moved verbatim from main).
    {
        let seed_url = config.database.url.clone();
        let seed_recipe = providers.catalog_recipe.clone();
        tokio::spawn(async move {
            let corpus_path = plnd_seed::ingredients::resolve_corpus_path();
            if let Err(e) = plnd_seed::run_seed(&seed_url, 3, &seed_recipe, &corpus_path).await {
                tracing::warn!(error = %e, "catalog seed failed (non-fatal)");
            }
        });
    }

    // Per-IP limiter for unauthenticated /client_error: 20 req/min/IP.
    let client_error_quota = Quota::per_minute(NonZeroU32::new(20).unwrap());
    let client_error_limiter = Arc::new(RateLimiter::keyed(client_error_quota));

    // Per-user limiter for POST /agent/task (env-driven, default 10 req/min).
    let agent_task_quota =
        Quota::per_minute(NonZeroU32::new(config.agent.rate_limit_per_minute).unwrap());
    let agent_task_limiter = Arc::new(RateLimiter::keyed(agent_task_quota));

    let session = SessionService::with_repo(repos.session.clone());
    let agent = plnd_agent::AgentService::new(&config.llm, repos.clone());

    Ok(Arc::new(AppState {
        repos,
        jwt,
        session,
        jwks,
        oidc_client_id: config.auth.oidc.client_id.clone(),
        provider_search: providers.search,
        briefing: providers.briefing,
        client_error_limiter,
        agent_task_limiter,
        agent,
        brand_normalizer: providers.brand_normalizer,
        meal_plan_concurrency: config.agent.meal_plan_concurrency,
    }))
}
```

- [ ] **Step 2: Wire `main.rs`**

Add `mod startup;` near the other `mod` declarations. Replace everything in `main.rs` from the `repos` connection (old line 106) through the `AppState` construction (old line 248) — including the seed spawn and rate-limiter/agent/session setup — with:
```rust
    let state = startup::build_state(&config).await?;
```
Note this requires `main()` to already return `Result` — if Task 5 hasn't run yet, temporarily keep the `match`/`exit` form by binding `let state = match startup::build_state(&config).await { Ok(s) => s, Err(e) => { tracing::error!(error = %e, "failed to build application state"); std::process::exit(1); } };`. Task 5 converts this to `?`.
Remove now-unused imports from `main.rs`: `governor::*`, `std::num::NonZeroU32`, the auth services, `std::sync::Arc` (if no longer used here), `plnd_data::Repositories`, `BriefingState`.

- [ ] **Step 3: Format + compile-check**

Run: `just fmt && just verify-build`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add plnd_api/src/startup.rs plnd_api/src/main.rs
git commit -m "refactor(plnd_api): extract AppState assembly into startup module"
```

---

### Task 4: Extract `router.rs`

Move the route tables, auth middleware, CORS, the trace/request-id/metrics layers, and the Swagger/Scalar mounts into `router.rs`.

**Files:**
- Create: `plnd_api/src/router.rs`
- Modify: `plnd_api/src/main.rs` (add `mod router;`; replace lines 250-481 with `cors_layer` + `build` calls)

**Interfaces:**
- Consumes: `crate::state::AppState`, all `plnd_api::routes::*` handlers, `plnd_api::middleware::*`, `plnd_api::openapi::ApiDoc`.
- Produces:
```rust
pub fn cors_layer(
    frontend_origin: &str,
) -> Result<tower_http::cors::CorsLayer, Box<dyn std::error::Error + Send + Sync>>;
pub fn build(
    state: std::sync::Arc<crate::state::AppState>,
    cors: tower_http::cors::CorsLayer,
) -> axum::Router;
```

- [ ] **Step 1: Create `router.rs`**

Create `plnd_api/src/router.rs` with these imports (moved from `main.rs`):
```rust
use std::sync::Arc;

use axum::http::{HeaderName, HeaderValue, Method};
use axum::{
    Router, middleware,
    routing::{delete, get, patch, post, put},
};
use tower_http::cors::CorsLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_scalar::{Scalar, Servable};
use utoipa_swagger_ui::SwaggerUi;

use crate::auth::auth_middleware;
use crate::middleware::metrics::HttpMetricsLayer;
use crate::middleware::trace_propagation::extract_trace_context;
use crate::openapi::ApiDoc;
use crate::state::AppState;
#[cfg(debug_assertions)]
use crate::routes::test_seed;
use crate::routes::{
    agent, auth, briefing, catalog_details, catalog_ingest, day_types, dietary_restrictions,
    meal_pattern, meal_suggestions, preferences, routine, schedule, schedule_anchors, search,
    system, tasks, timezone, user_dish_prefs, user_ingredient_prefs, user_meal_prefs, users,
};
```
Add `cors_layer` (moves the parse from old `main.rs:141-145` + the CORS builder from `main.rs:252-267`):
```rust
/// Build the CORS layer from the configured frontend origin.
/// Returns `Err` if `frontend_origin` is not a valid `HeaderValue`
/// (replaces the previous `.expect(...)` panic).
pub fn cors_layer(
    frontend_origin: &str,
) -> Result<CorsLayer, Box<dyn std::error::Error + Send + Sync>> {
    let origin: HeaderValue = frontend_origin.parse()?;
    Ok(CorsLayer::new()
        .allow_origin(origin)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            HeaderName::from_static("x-request-id"),
        ])
        .expose_headers([HeaderName::from_static("x-request-id")]))
}
```
Add `build` — move the `protected` router (old `main.rs:269-452`), the `#[cfg(debug_assertions)]` test-seed route (453-458), the auth-layer attach (460-463), the `public` router (465-469), and the final `app` assembly (471-481) verbatim, ending by returning `app`:
```rust
pub fn build(state: Arc<AppState>, cors: CorsLayer) -> Router {
    let protected = Router::new()
        // … all .route(...) calls moved verbatim from old main.rs:270-452 …
        ;

    #[cfg(debug_assertions)]
    let protected = protected.route("/test/seed", post(test_seed::post_seed));

    let protected = protected.layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    let public = Router::new()
        .route("/health", get(system::health_check))
        .route("/ready", get(system::readiness_check))
        .route("/auth/token", post(auth::token_exchange))
        .route("/client_error", post(system::report_client_error));

    let x_request_id = HeaderName::from_static("x-request-id");

    public
        .merge(protected)
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .merge(Scalar::with_url("/scalar", ApiDoc::openapi()))
        .with_state(state)
        .layer(middleware::from_fn(extract_trace_context))
        .layer(TraceLayer::new_for_http())
        .layer(PropagateRequestIdLayer::new(x_request_id.clone()))
        .layer(SetRequestIdLayer::new(x_request_id, MakeRequestUuid))
        .route_layer(HttpMetricsLayer)
        .layer(cors)
}
```
(Copy the full `.route(...)` list verbatim from old `main.rs:270-452` into the `protected` builder — do not abbreviate in the real file.)

- [ ] **Step 2: Add a router construction test**

At the bottom of `router.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cors_layer_rejects_invalid_origin() {
        assert!(cors_layer("not a valid header\nvalue").is_err());
    }

    #[test]
    fn cors_layer_accepts_valid_origin() {
        assert!(cors_layer("http://localhost:4200").is_ok());
    }
}
```
(A full `build()` smoke test needs a constructed `AppState`, which requires a DB; the existing e2e suite already exercises the routes end-to-end, so we keep the unit test to the DB-free `cors_layer`.)

- [ ] **Step 3: Wire `main.rs`**

Add `mod router;`. Replace `main.rs` lines 250-481 (the `x_request_id`/`cors`/`protected`/`public`/`app` block) with:
```rust
    let cors = router::cors_layer(&config.auth.frontend_origin)?; // or match/exit until Task 5
    let app = router::build(state, cors);
```
Remove now-unused imports from `main.rs`: all `axum::*` routing, `tower_http::*`, `utoipa*`, `HttpMetricsLayer`, `extract_trace_context`, `auth_middleware`, `ApiDoc`, the `routes::*` and `test_seed` imports.

- [ ] **Step 4: Format + compile-check + unit test**

Run: `just fmt && just verify-build`
Then: `cargo nextest run -p plnd_api router::tests` is discouraged per project rules — instead rely on the full `just verify` in Task 5 for tests. For a quick local check, `just verify-build` confirms compilation.
Expected: compiles clean.

- [ ] **Step 5: Commit**

```bash
git add plnd_api/src/router.rs plnd_api/src/main.rs
git commit -m "refactor(plnd_api): extract route table + middleware into router module"
```

---

### Task 5: Finalize `main()` — `Result` + `?` + import cleanup

Collapse `main()` to its final orchestration form and convert all remaining `match … process::exit` / `.unwrap()` to `?`.

**Files:**
- Modify: `plnd_api/src/main.rs` (final form)

**Interfaces:**
- Consumes: `telemetry::{init_providers, init_subscriber, shutdown_providers}`, `startup::build_state`, `router::{cors_layer, build}`.
- Produces: final `main()`.

- [ ] **Step 1: Rewrite `main.rs` to final form**

```rust
mod providers;
mod router;
mod startup;
mod telemetry;

use plnd_api::config;
use std::net::SocketAddr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = match config::load_config() {
        Ok(config) => config,
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

    // Flush all OTEL providers before exit to prevent dropped spans/logs/metrics.
    if let Some(providers) = otel {
        telemetry::shutdown_providers(providers);
    }
    Ok(())
}
```
Note: `init_providers` previously did `match … exit(1)`; with `?` its `Box<dyn Error>` propagates and tokio's `main` prints it to stderr and exits non-zero — acceptable (it runs before the subscriber too, but its error is descriptive). If you prefer the prior explicit message, keep a `match` for `init_providers` only; otherwise `?` is fine.

- [ ] **Step 2: Format**

Run: `just fmt`

- [ ] **Step 3: Full verification**

Ensure shared infra is up first (ask the user to run `just persist` if `db`/`mock-oauth` are not running — agents must never run `persist`).
Run (bare, never piped): `just verify`
Expected: ends with `✅ All verifications passed`.

- [ ] **Step 4: Commit**

```bash
git add plnd_api/src/main.rs
git commit -m "refactor(plnd_api): collapse main() to Result-based orchestration"
```

---

## Self-Review

**Spec coverage:**
- Module split (telemetry/providers/startup/router) → Tasks 1–4. ✓
- `main()` → ~30-line `Result` orchestration → Task 5. ✓
- `init_subscriber` extraction → Task 1. ✓
- `Providers` struct + `catalog_recipe` reuse by seed → Tasks 2–3. ✓
- CORS as `router::cors_layer(&str) -> Result` handed into `build` → Task 4. ✓
- Retained fixture `process::exit(1)` → preserved (moved verbatim in Task 2). ✓
- `?`-propagation + single config-load `eprintln`/exit → Task 5. ✓
- Router construction test → Task 4 (DB-free `cors_layer` tests). ✓
- Behavior-preserving (verbatim route/layer moves, `#[cfg]` carried with code) → Global Constraints + each task. ✓

**Placeholder scan:** "move verbatim from old main.rs:NNN" references are exact source-line citations for a move-refactor, not placeholders — the code to move already exists and is unambiguous. No "TBD"/"add error handling"/"similar to" placeholders remain.

**Type consistency:** `AppConfig` (not `Settings`) used throughout. `Providers { search, briefing, brand_normalizer, catalog_recipe }` field names consistent across Tasks 2–3. `cors_layer`/`build` signatures consistent across Task 4 and Task 5. `init_subscriber(&LoggingConfig, Option<&TelemetryProviders>)` consistent across Tasks 1 and 5.
