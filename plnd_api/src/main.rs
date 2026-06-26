mod providers;
mod startup;
mod telemetry;

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

use plnd_api::middleware::metrics::HttpMetricsLayer;
use plnd_api::middleware::trace_propagation::extract_trace_context;

use std::net::SocketAddr;

use plnd_api::auth::auth_middleware;
use plnd_api::config;
use plnd_api::openapi::ApiDoc;
#[cfg(debug_assertions)]
use plnd_api::routes::test_seed;
use plnd_api::routes::{
    agent, auth, briefing, catalog_details, catalog_ingest, day_types, dietary_restrictions,
    meal_pattern, meal_suggestions, preferences, routine, schedule, schedule_anchors, search,
    system, tasks, timezone, user_dish_prefs, user_ingredient_prefs, user_meal_prefs, users,
};
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

    telemetry::init_subscriber(&config.logging, otel_providers.as_ref());

    let state = match startup::build_state(&config).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "failed to build application state");
            std::process::exit(1);
        }
    };

    let cors_origin: HeaderValue = config
        .auth
        .frontend_origin
        .parse()
        .expect("invalid CORS origin in auth.frontend_origin");

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
        .route("/schedule/entries/{id}", patch(schedule::patch_entry))
        .route(
            "/schedule/entries/{id}/position",
            patch(schedule::reposition_entry),
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
        // Timezone anchors
        .route(
            "/timezone/anchors",
            get(timezone::list_anchors).post(timezone::create_anchor),
        )
        .route("/timezone/anchors/{id}", delete(timezone::delete_anchor))
        .route(
            "/timezone/anchors/group/{inference_group}",
            delete(timezone::delete_anchor_group),
        )
        .route("/timezone/resolve", get(timezone::resolve_zone))
        .route("/timezone/device", post(timezone::device_affirm))
        .route(
            "/timezone/standoff/dismiss",
            post(timezone::dismiss_standoff),
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
