mod telemetry;

use axum::http::{HeaderName, HeaderValue, Method};
use axum::{
    Router, middleware,
    routing::{delete, get, patch, post, put},
};
use governor::{Quota, RateLimiter};
use opentelemetry::trace::TracerProvider;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use std::num::NonZeroU32;
use tower_http::cors::CorsLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use utoipa::OpenApi;
use utoipa_scalar::{Scalar, Servable};
use utoipa_swagger_ui::SwaggerUi;

use plnd_api::middleware::metrics::HttpMetricsLayer;
use plnd_api::middleware::trace_propagation::extract_trace_context;

use std::net::SocketAddr;
use std::sync::Arc;

use plnd_api::auth::auth_middleware;
use plnd_api::auth::{JwksCache, JwtService, SessionService};
use plnd_api::briefing::BriefingState;
use plnd_api::config;
use plnd_api::openapi::ApiDoc;
#[cfg(debug_assertions)]
use plnd_api::routes::test_seed;
use plnd_api::routes::{
    agent, auth, briefing, catalog_details, catalog_ingest, day_types, dietary_restrictions,
    meal_pattern, meal_suggestions, preferences, routine, schedule, schedule_anchors, search,
    system, tasks, user_dish_prefs, user_ingredient_prefs, user_meal_prefs, users,
};
use plnd_api::state::AppState;
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

#[tokio::main]
async fn main() {
    let config = match config::load_config() {
        Ok(config) => config,
        Err(e) => {
            // Subscriber not yet initialized — eprintln is the only option here
            eprintln!("Failed to load configuration: {}", e);
            std::process::exit(1);
        }
    };

    // Initialize OTEL providers before the subscriber (tracer needed for subscriber layer).
    let otel_providers = match telemetry::init_providers(config.otel.endpoint.as_deref()) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Failed to initialize OTEL providers: {e}");
            std::process::exit(1);
        }
    };

    // Build layered tracing subscriber.
    // Each arm of the match produces a different concrete type — all are valid Subscriber impls.
    let env_filter = || tracing_subscriber::EnvFilter::new(&config.logging.level);

    match (config.logging.pretty_print, otel_providers.as_ref()) {
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

    tracing::info!(
        api_base_url = %config.api.base_url,
        log_level = %config.logging.level,
        otel_enabled = config.otel.endpoint.is_some(),
        "configuration loaded"
    );

    let repos = match plnd_data::Repositories::new(
        &config.database.url,
        config.database.max_connections as u32,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "failed to connect to database or run migrations");
            std::process::exit(1);
        }
    };
    tracing::info!("database connected and migrations applied");

    let jwt = JwtService::new(
        config.auth.jwt.secret.clone(),
        config.auth.jwt.jwt_expiration,
    );

    // Build the JWKS cache. The internal_issuer_url (Docker-internal hostname) is used
    // for server-to-server JWKS fetching; the external issuer_url is used to validate
    // the `iss` claim that the IdP embeds in tokens.
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

    let cors_origin: HeaderValue = config
        .auth
        .frontend_origin
        .parse()
        .expect("invalid CORS origin in auth.frontend_origin");

    // Construct external providers
    let nutrition_usda: Arc<dyn plnd_data::providers::NutritionProvider> = Arc::new(
        UsdaFdcProvider::new(&config.external_providers.usda_fdc_api_key),
    );
    let off_basic_auth = if config.external_providers.off_basic_auth_user.is_empty() {
        None
    } else {
        Some((
            config.external_providers.off_basic_auth_user.clone(),
            config.external_providers.off_basic_auth_password.clone(),
        ))
    };
    let nutrition_off: Arc<dyn plnd_data::providers::NutritionProvider> = Arc::new(
        OpenFoodFactsProvider::new(&config.external_providers.off_base_url, off_basic_auth),
    );
    let recipe_mdb = Arc::new(TheMealDbProvider::new(
        &config.external_providers.themealdb_api_key,
    ));

    if config.external_providers.usda_fdc_api_key.is_empty() {
        tracing::warn!(
            "USDA FDC provider: no API key set (will return ConfigurationError at runtime)"
        );
    } else {
        tracing::info!("USDA FDC provider: ready");
    }
    tracing::info!(base_url = %config.external_providers.off_base_url, "Open Food Facts provider: ready");
    tracing::info!("TheMealDB provider: ready");

    // Build the catalog providers once, then share between the seed task and the
    // search service. When `fixture_path` is set, both paths read from
    // disk-captured fixtures so the catalog is populated identically to a live
    // boot — used by `just verify` and CI to avoid burning USDA/OFF/TheMealDB
    // quota.
    let catalog_nutrition = build_nutrition_providers(
        &config.external_providers,
        nutrition_usda.clone(),
        nutrition_off.clone(),
    );
    let catalog_recipe = build_recipe_providers(&config.external_providers, recipe_mdb.clone());

    // Seed catalog tables in the background so the server binds immediately.
    // The seed is idempotent — safe to run on every startup. It fails gracefully:
    // a missing API key or network error produces a non-fatal warning, not a
    // startup failure.
    {
        let seed_url = config.database.url.clone();
        let seed_nutrition = catalog_nutrition.clone();
        let seed_recipe = catalog_recipe.clone();
        tokio::spawn(async move {
            if let Err(e) = plnd_seed::run_seed(&seed_url, 3, &seed_nutrition, &seed_recipe).await {
                tracing::warn!(error = %e, "catalog seed failed (non-fatal)");
            }
        });
    }

    let search_cache = SearchCache::new(config.external_providers.search_cache_ttl_hours);
    let provider_search =
        ProviderSearchService::new(catalog_nutrition, catalog_recipe, vec![], search_cache);

    let (weather_provider, news_provider) = build_briefing_providers(&config.external_providers);
    let briefing = BriefingState::new(weather_provider, news_provider);
    if config.external_providers.fixture_path.is_none() {
        if config.external_providers.news_feed_urls.is_empty() {
            tracing::warn!("briefing news feed disabled (news_feed_urls not set)");
        } else {
            tracing::info!(
                feed_count = config.external_providers.news_feed_urls.len(),
                "briefing news feeds configured"
            );
        }
    }

    // Per-IP rate limiter for unauthenticated /api/client_error requests.
    // 20 requests per minute per IP; authenticated requests bypass this.
    let client_error_quota = Quota::per_minute(NonZeroU32::new(20).unwrap());
    let client_error_limiter = Arc::new(RateLimiter::keyed(client_error_quota));

    // Per-user rate limiter for POST /agent/task. Quota is env-driven via
    // APP_AGENT__RATE_LIMIT_PER_MINUTE (default 10 req/min).
    let agent_task_quota =
        Quota::per_minute(NonZeroU32::new(config.agent.rate_limit_per_minute).unwrap());
    let agent_task_limiter = Arc::new(RateLimiter::keyed(agent_task_quota));

    let session = SessionService::with_repo(repos.session.clone());
    let agent = plnd_agent::AgentService::new(&config.llm, repos.clone());

    let state = Arc::new(AppState {
        repos,
        jwt,
        session,
        jwks,
        oidc_client_id: config.auth.oidc.client_id.clone(),
        provider_search,
        briefing,
        client_error_limiter,
        agent_task_limiter,
        agent,
        meal_plan_concurrency: config.agent.meal_plan_concurrency,
    });

    let x_request_id = HeaderName::from_static("x-request-id");

    let cors = CorsLayer::new()
        .allow_origin(cors_origin)
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
        .expose_headers([HeaderName::from_static("x-request-id")]);

    let protected = Router::new()
        .route("/users/me", get(users::get_me))
        .route("/users/me", patch(users::patch_me))
        .route("/users/me", delete(users::delete_me))
        .route(
            "/users/me/complete-onboarding",
            post(users::post_complete_onboarding),
        )
        .route(
            "/preferences/me",
            get(preferences::get_preferences).patch(preferences::patch_preferences),
        )
        .route(
            "/dietary-restrictions",
            get(dietary_restrictions::list_restrictions),
        )
        .route(
            "/dietary-restrictions",
            post(dietary_restrictions::create_restriction),
        )
        .route(
            "/dietary-restrictions/{id}",
            patch(dietary_restrictions::update_restriction),
        )
        .route(
            "/dietary-restrictions/{id}",
            delete(dietary_restrictions::delete_restriction),
        )
        .route(
            "/day-types/{day_type_id}/meals",
            get(meal_pattern::list_meal_pattern).post(meal_pattern::create_meal_pattern_entry),
        )
        .route(
            "/day-types/{day_type_id}/meals/{meal_id}",
            patch(meal_pattern::update_meal_pattern_entry)
                .delete(meal_pattern::delete_meal_pattern_entry),
        )
        .route(
            "/search/ingredients",
            get(search::search_ingredients_handler),
        )
        .route("/search/dishes", get(search::search_dishes_handler))
        .route("/search/exercises", get(search::search_exercises_handler))
        // Catalog detail (read-only, auth required)
        .route(
            "/catalog/ingredients",
            post(catalog_ingest::contribute_ingredient),
        )
        .route(
            "/catalog/ingredients/ingest",
            post(catalog_ingest::ingest_ingredient),
        )
        .route(
            "/catalog/ingredients/promote",
            post(catalog_ingest::promote_ingredient),
        )
        .route(
            "/catalog/ingredients/{id}",
            get(catalog_details::get_ingredient),
        )
        .route("/catalog/dishes/{id}", get(catalog_details::get_dish))
        .route("/catalog/meals/{id}", get(catalog_details::get_meal))
        // Ingredient preferences
        .route("/my/ingredient-prefs", get(user_ingredient_prefs::list))
        .route(
            "/my/ingredient-prefs/{id}",
            put(user_ingredient_prefs::upsert),
        )
        .route(
            "/my/ingredient-prefs/{id}",
            delete(user_ingredient_prefs::delete),
        )
        // Dish library
        .route("/my/dishes", get(user_dish_prefs::list))
        .route("/my/dishes", post(user_dish_prefs::create))
        .route("/my/dishes/{pref_id}", get(user_dish_prefs::get_detail))
        .route("/my/dishes/{pref_id}", patch(user_dish_prefs::patch))
        .route("/my/dishes/{pref_id}", delete(user_dish_prefs::delete))
        .route(
            "/my/dishes/{pref_id}/ingredients",
            post(user_dish_prefs::add_ingredient),
        )
        .route(
            "/my/dishes/{pref_id}/ingredients/{ingredient_id}",
            delete(user_dish_prefs::remove_ingredient),
        )
        // Meal library
        .route("/my/meals", get(user_meal_prefs::list))
        .route("/my/meals", post(user_meal_prefs::create))
        .route("/my/meals/{pref_id}", get(user_meal_prefs::get_detail))
        .route("/my/meals/{pref_id}", patch(user_meal_prefs::patch))
        .route("/my/meals/{pref_id}", delete(user_meal_prefs::delete))
        .route(
            "/my/meals/{pref_id}/dishes",
            post(user_meal_prefs::add_dish),
        )
        .route(
            "/my/meals/{pref_id}/dishes/{dish_id}",
            delete(user_meal_prefs::remove_dish),
        )
        .route(
            "/my/meal-suggestions",
            get(meal_suggestions::get_suggestions),
        )
        .route("/tasks/weekly-plan", post(tasks::post_weekly_plan_task))
        .route("/schedule/period", get(schedule::get_period))
        .route(
            "/schedule/plan/carryover",
            get(schedule::get_plan_carryover),
        )
        .route("/schedule/plan/status", get(schedule::get_plan_status))
        .route("/schedule/plan", post(schedule::post_plan))
        .route(
            "/schedule/entries/{id}/status",
            patch(schedule::patch_entry_status),
        )
        .route(
            "/schedule/anchors",
            get(schedule_anchors::list_for_date).post(schedule_anchors::create),
        )
        .route(
            "/schedule/anchors/{id}",
            patch(schedule_anchors::update).delete(schedule_anchors::delete),
        )
        .route(
            "/schedule/anchors/{id}/status",
            patch(schedule_anchors::set_status),
        )
        .route(
            "/routines",
            get(routine::list_routines).post(routine::create_routine),
        )
        .route(
            "/routines/{id}",
            delete(routine::delete_routine).put(routine::update_routine),
        )
        .route(
            "/day-types",
            get(day_types::list_day_types).post(day_types::create_day_type),
        )
        .route(
            "/day-types/{id}",
            put(day_types::update_day_type).delete(day_types::delete_day_type),
        )
        .route("/briefing/weather", get(briefing::get_weather))
        .route("/briefing/news", get(briefing::get_news))
        .route("/briefing/yesterday", get(briefing::get_yesterday))
        .route("/auth/logout", post(auth::logout))
        .route("/agent/task", post(agent::post_task))
        .route("/agent/meal-plan", post(agent::post_meal_plan))
        .route(
            "/agent/meal-plan/rebalance",
            post(agent::post_meal_plan_rebalance),
        )
        .route(
            "/agent/meal-plan/suggest",
            post(agent::post_meal_plan_suggest),
        )
        .route(
            "/agent/meal-plan/resolve",
            post(agent::post_meal_plan_resolve),
        )
        .route("/agent/place-tasks", post(agent::post_place_tasks));

    // Dev-only test seeding endpoint. The route is physically absent from
    // release builds; e2e tests use it to put the calling user into a
    // deterministic state without page.route() mocks. See routes/test_seed.rs.
    #[cfg(debug_assertions)]
    let protected = protected.route("/test/seed", post(test_seed::post_seed));

    let protected = protected.layer(middleware::from_fn_with_state(
        state.clone(),
        auth_middleware,
    ));

    let public = Router::new()
        .route("/health", get(system::health_check))
        .route("/ready", get(system::readiness_check))
        .route("/auth/token", post(auth::token_exchange))
        .route("/client_error", post(system::report_client_error));

    let app = public
        .merge(protected)
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .merge(Scalar::with_url("/scalar", ApiDoc::openapi()))
        .with_state(state)
        .layer(middleware::from_fn(extract_trace_context))
        .layer(TraceLayer::new_for_http())
        .layer(PropagateRequestIdLayer::new(x_request_id.clone()))
        .layer(SetRequestIdLayer::new(x_request_id, MakeRequestUuid))
        .route_layer(HttpMetricsLayer)
        .layer(cors);

    let listener = tokio::net::TcpListener::bind(&config.api.base_url)
        .await
        .unwrap();
    tracing::info!(addr = %listener.local_addr().unwrap(), "API server listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();

    // Flush all OTEL providers before exit to prevent dropped spans/logs/metrics.
    if let Some(providers) = otel_providers {
        telemetry::shutdown_providers(providers);
    }
}

/// Constructs the weather + news providers for the briefing handlers.
///
/// In debug builds, if `external.fixture_path` is set, returns file-backed
/// implementations that read captured upstream responses from disk — used by
/// e2e to keep tests deterministic and offline. Otherwise (and always in
/// release builds, where the fixture impls do not exist) returns the real
/// Open-Meteo + RSS providers.
fn build_briefing_providers(
    external: &plnd_api::config::settings::ExternalProvidersConfig,
) -> (Arc<dyn WeatherProvider>, Arc<dyn NewsProvider>) {
    #[cfg(debug_assertions)]
    if let Some(fixture_root) = &external.fixture_path {
        tracing::warn!(
            path = %fixture_root.display(),
            "USING FIXTURE PROVIDERS for /briefing/* — debug builds only; never enable in prod"
        );
        let weather_path = fixture_root.join("open-meteo/forecast.json");
        let weather = FixtureWeatherProvider::new(weather_path).unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to load fixture weather provider");
            std::process::exit(1);
        });
        let rss_dir = fixture_root.join("rss");
        let feed_paths: Vec<std::path::PathBuf> = std::fs::read_dir(&rss_dir)
            .unwrap_or_else(|e| {
                tracing::error!(path = %rss_dir.display(), error = %e, "failed to read fixture rss dir");
                std::process::exit(1);
            })
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("xml"))
            .collect();
        let news = FixtureNewsProvider::new(feed_paths).unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to load fixture news provider");
            std::process::exit(1);
        });
        return (Arc::new(weather), Arc::new(news));
    }

    (
        Arc::new(OpenMeteoProvider::new()),
        Arc::new(RssFeedProvider::new(&external.news_feed_urls)),
    )
}

/// Constructs the nutrition providers for the search service.
///
/// In debug builds, if `external.fixture_path` is set, returns file-backed
/// implementations that replay captured search results from disk — used by
/// e2e to keep tests deterministic and offline. Otherwise (and always in
/// release builds) returns the real USDA FDC + Open Food Facts providers.
///
/// The live providers are passed in rather than constructed here because they
/// are also used by the catalog seed task running concurrently.
fn build_nutrition_providers(
    external: &plnd_api::config::settings::ExternalProvidersConfig,
    usda: Arc<dyn plnd_data::providers::NutritionProvider>,
    off: Arc<dyn plnd_data::providers::NutritionProvider>,
) -> Vec<Arc<dyn plnd_data::providers::NutritionProvider>> {
    #[cfg(debug_assertions)]
    if let Some(fixture_root) = &external.fixture_path {
        tracing::warn!(
            path = %fixture_root.display(),
            "USING FIXTURE NUTRITION PROVIDERS for catalog seed + /search/ingredients — debug builds only; never enable in prod"
        );
        let make = |source: &str, dir: &str| {
            let search_path = fixture_root.join(dir).join("search.json");
            let lookup_path = fixture_root.join(dir).join("lookup.json");
            FixtureNutritionProvider::new(source.to_string(), search_path, lookup_path)
                .unwrap_or_else(|e| {
                    tracing::error!(error = %e, "failed to load nutrition fixture");
                    std::process::exit(1);
                })
        };
        return vec![
            Arc::new(make("usda_fdc", "nutrition/usda_fdc")),
            Arc::new(make("openfoodfacts", "nutrition/open_food_facts")),
        ];
    }
    vec![usda, off]
}

/// Constructs the recipe providers for the catalog seed + search service.
///
/// In debug builds, if `external.fixture_path` is set, returns file-backed
/// implementations that replay captured search + lookup results from disk —
/// used by e2e to keep tests deterministic and offline. Otherwise (and always
/// in release builds) returns the real TheMealDB provider.
fn build_recipe_providers(
    external: &plnd_api::config::settings::ExternalProvidersConfig,
    mdb: Arc<dyn plnd_data::providers::RecipeProvider>,
) -> Vec<Arc<dyn plnd_data::providers::RecipeProvider>> {
    #[cfg(debug_assertions)]
    if let Some(fixture_root) = &external.fixture_path {
        tracing::warn!(
            path = %fixture_root.display(),
            "USING FIXTURE RECIPE PROVIDERS for catalog seed + /search/dishes — debug builds only; never enable in prod"
        );
        let search_path = fixture_root.join("recipe/themealdb/search.json");
        let lookup_path = fixture_root.join("recipe/themealdb/lookup.json");
        let provider =
            TheMealDbFixtureProvider::new(search_path, lookup_path).unwrap_or_else(|e| {
                tracing::error!(error = %e, "failed to load recipe fixture");
                std::process::exit(1);
            });
        return vec![Arc::new(provider)];
    }
    vec![mdb]
}
