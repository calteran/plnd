mod telemetry;

use axum::http::{HeaderName, HeaderValue, Method};
use axum::{
    middleware,
    routing::{delete, get, patch, post, put},
    Router,
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
use plnd_api::routes::{
    agent, auth, briefing, catalog_details, catalog_ingest, dietary_restrictions, meal_suggestions,
    preferences, schedule, search, system, tasks, user_dish_prefs, user_ingredient_prefs,
    user_meal_prefs, users,
};
use plnd_api::state::AppState;
use plnd_data::cache::SearchCache;
use plnd_data::db::Database;
use plnd_data::providers::{
    OpenFoodFactsProvider, OpenMeteoProvider, RssFeedProvider, TheMealDbProvider, UsdaFdcProvider,
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

    let db_conn =
        match Database::new(&config.database.url, config.database.max_connections as u32).await {
            Ok(db) => db,
            Err(e) => {
                tracing::error!(error = %e, "failed to connect to database");
                std::process::exit(1);
            }
        };

    if let Err(e) = plnd_data::db::run_migrations(db_conn.get_pool()).await {
        tracing::error!(error = %e, "failed to run database migrations");
        std::process::exit(1);
    }
    tracing::info!("database migrations applied successfully");

    let jwt = JwtService::new(
        config.auth.jwt.secret.clone(),
        config.auth.jwt.jwt_expiration,
    );

    let session = SessionService::with_db(db_conn.clone());

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
    let nutrition_usda = Arc::new(UsdaFdcProvider::new(
        &config.external_providers.usda_fdc_api_key,
    ));
    let off_basic_auth = if config.external_providers.off_basic_auth_user.is_empty() {
        None
    } else {
        Some((
            config.external_providers.off_basic_auth_user.clone(),
            config.external_providers.off_basic_auth_password.clone(),
        ))
    };
    let nutrition_off = Arc::new(OpenFoodFactsProvider::new(
        &config.external_providers.off_base_url,
        off_basic_auth,
    ));
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

    // Seed catalog tables in the background so the server binds immediately.
    // The seed is idempotent — safe to run on every startup.
    {
        let seed_pool = db_conn.get_pool().clone();
        let seed_nutrition: Vec<std::sync::Arc<dyn plnd_data::providers::NutritionProvider>> =
            vec![nutrition_usda.clone(), nutrition_off.clone()];
        let seed_recipe: Vec<std::sync::Arc<dyn plnd_data::providers::RecipeProvider>> =
            vec![recipe_mdb.clone()];
        tokio::spawn(async move {
            if let Err(e) = plnd_seed::seed(&seed_pool, &seed_nutrition, &seed_recipe).await {
                tracing::warn!(error = %e, "catalog seed failed (non-fatal)");
            }
        });
    }

    let search_cache = SearchCache::new(config.external_providers.search_cache_ttl_hours);
    let provider_search = ProviderSearchService::new(
        vec![nutrition_usda, nutrition_off],
        vec![recipe_mdb],
        vec![],
        search_cache,
    );

    let weather_provider = Arc::new(OpenMeteoProvider::new());
    let news_provider = Arc::new(RssFeedProvider::new(
        &config.external_providers.news_feed_urls,
    ));
    let briefing = BriefingState::new(weather_provider, news_provider);
    if config.external_providers.news_feed_urls.is_empty() {
        tracing::warn!("briefing news feed disabled (news_feed_urls not set)");
    } else {
        tracing::info!(
            feed_count = config.external_providers.news_feed_urls.len(),
            "briefing news feeds configured"
        );
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

    let repos = plnd_data::Repositories::from_database(&db_conn);
    let agent = plnd_agent::AgentService::new(&config.llm, repos);

    let state = Arc::new(AppState {
        db: db_conn,
        jwt,
        session,
        jwks,
        oidc_client_id: config.auth.oidc.client_id.clone(),
        provider_search,
        briefing,
        client_error_limiter,
        agent_task_limiter,
        agent,
    });

    let x_request_id = HeaderName::from_static("x-request-id");

    let cors = CorsLayer::new()
        .allow_origin(cors_origin)
        .allow_methods([
            Method::GET,
            Method::POST,
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
            "/search/ingredients",
            get(search::search_ingredients_handler),
        )
        .route("/search/dishes", get(search::search_dishes_handler))
        .route("/search/exercises", get(search::search_exercises_handler))
        // Catalog detail (read-only, auth required)
        .route(
            "/catalog/ingredients/ingest",
            post(catalog_ingest::ingest_ingredient),
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
        .route("/schedule/plan/status", get(schedule::get_plan_status))
        .route("/schedule/plan", post(schedule::post_plan))
        .route(
            "/schedule/entries/{id}/status",
            patch(schedule::patch_entry_status),
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
        .layer(middleware::from_fn_with_state(
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
