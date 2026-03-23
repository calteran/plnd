use axum::http::{HeaderValue, Method};
use axum::{
    middleware,
    routing::{delete, get, patch, post, put},
    Router,
};
use tower_http::cors::CorsLayer;
use utoipa::OpenApi;
use utoipa_scalar::{Scalar, Servable};
use utoipa_swagger_ui::SwaggerUi;

use std::sync::Arc;

use plnd_api::auth::auth_middleware;
use plnd_api::auth::{JwksCache, JwtService, SessionService};
use plnd_api::config;
use plnd_api::db::Database;
use plnd_api::openapi::ApiDoc;
use plnd_api::routes::{
    auth, catalog_details, catalog_ingest, dietary_restrictions, preferences, schedule, search,
    system, tasks, user_dish_prefs, user_ingredient_prefs, user_meal_prefs, users,
};
use plnd_api::state::AppState;
use plnd_data::cache::SearchCache;
use plnd_data::clients::{OpenFoodFactsClient, TheMealDbClient, UsdaFdcClient};
use plnd_data::search::ProviderSearchService;

#[tokio::main]
async fn main() {
    let config = match config::load_config() {
        Ok(config) => config,
        Err(e) => {
            eprintln!("Failed to load configuration: {}", e);
            std::process::exit(1);
        }
    };

    println!("Loaded configuration:");
    println!("  API Base URL: {}", config.api.base_url);
    println!("  Database URL: {}", config.database.url);
    println!("  Log Level: {}", config.logging.level);

    let db_conn =
        match Database::new(&config.database.url, config.database.max_connections as u32).await {
            Ok(db) => db,
            Err(e) => {
                eprintln!("Failed to connect to database: {}", e);
                std::process::exit(1);
            }
        };

    if let Err(e) = sqlx::migrate!("./migrations").run(db_conn.get_pool()).await {
        eprintln!("Failed to run database migrations: {}", e);
        std::process::exit(1);
    }
    println!("Database migrations applied successfully");

    let jwt = JwtService::new(
        config.auth.jwt.secret.clone(),
        config.auth.jwt.jwt_expiration,
    );

    let session = SessionService::with_pool(db_conn.get_pool().clone());

    // Build the JWKS cache. The internal_issuer_url (Docker-internal hostname) is used
    // for server-to-server JWKS fetching; the external issuer_url is used to validate
    // the `iss` claim that the IdP embeds in tokens.
    let internal_issuer = if config.auth.oidc.internal_issuer_url.is_empty() {
        config.auth.oidc.issuer_url.clone()
    } else {
        config.auth.oidc.internal_issuer_url.clone()
    };
    let jwks = JwksCache::new(config.auth.oidc.issuer_url.clone(), internal_issuer);

    println!("  OIDC issuer: {}", config.auth.oidc.issuer_url);
    println!("  OIDC client_id: {}", config.auth.oidc.client_id);

    let cors_origin: HeaderValue = config
        .auth
        .frontend_origin
        .parse()
        .expect("invalid CORS origin in auth.frontend_origin");

    // Construct external provider clients
    let nutrition_usda = Arc::new(UsdaFdcClient::new(
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
    let nutrition_off = Arc::new(OpenFoodFactsClient::new(
        &config.external_providers.off_base_url,
        off_basic_auth,
    ));
    let recipe_mdb = Arc::new(TheMealDbClient::new(
        &config.external_providers.themealdb_api_key,
    ));
    if config.external_providers.usda_fdc_api_key.is_empty() {
        println!("  USDA FDC provider: no API key set (will return ConfigurationError at runtime)");
    } else {
        println!("  USDA FDC provider: ready");
    }
    println!(
        "  Open Food Facts provider: ready ({})",
        config.external_providers.off_base_url
    );
    println!(
        "  TheMealDB provider: ready (key={})",
        config.external_providers.themealdb_api_key
    );

    // Seed catalog tables in the background so the server binds immediately.
    // The seed is idempotent — safe to run on every startup.
    {
        let seed_pool = db_conn.get_pool().clone();
        let seed_nutrition: Vec<std::sync::Arc<dyn plnd_data::clients::NutritionProvider>> =
            vec![nutrition_usda.clone(), nutrition_off.clone()];
        let seed_recipe: Vec<std::sync::Arc<dyn plnd_data::clients::RecipeProvider>> =
            vec![recipe_mdb.clone()];
        tokio::spawn(async move {
            if let Err(e) = plnd_seed::seed(&seed_pool, &seed_nutrition, &seed_recipe).await {
                eprintln!("Warning: catalog seed failed: {}", e);
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

    let state = Arc::new(AppState {
        db: db_conn,
        jwt,
        session,
        jwks,
        oidc_client_id: config.auth.oidc.client_id.clone(),
        provider_search,
    });

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
        ]);

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
            "/tasks/weekly-plan",
            post(tasks::post_weekly_plan_task),
        )
        .route("/schedule/period", get(schedule::get_period))
        .route("/schedule/plan/status", get(schedule::get_plan_status))
        .route("/auth/logout", post(auth::logout))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let public = Router::new()
        .route("/health", get(system::health_check))
        .route("/ready", get(system::readiness_check))
        .route("/auth/token", post(auth::token_exchange));

    let app = public
        .merge(protected)
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .merge(Scalar::with_url("/scalar", ApiDoc::openapi()))
        .with_state(state)
        .layer(cors);

    let listener = tokio::net::TcpListener::bind(&config.api.base_url)
        .await
        .unwrap();
    println!("API server listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}
