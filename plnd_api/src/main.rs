use axum::http::{HeaderValue, Method, StatusCode};
use axum::{
    extract::State,
    middleware,
    routing::{delete, get, patch},
    Json, Router,
};
use chrono::Utc;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use plnd_api::auth::auth_middleware;
use plnd_api::auth::oauth::{MockOAuthProvider, OAuthProviderConfig};
use plnd_api::auth::{JwtService, SessionService};
use plnd_api::config;
use plnd_api::config::settings::OAuthProviderConfig as ConfigOAuthProvider;
use plnd_api::db::models::ReadyStatus;
use plnd_api::db::Database;
use plnd_api::routes::{auth, preferences, users};
use plnd_api::state::AppState;

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

    let mock_cfg: ConfigOAuthProvider = config
        .auth
        .oauth_providers
        .iter()
        .find(|p| p.name == "mock" && p.enabled)
        .cloned()
        .unwrap_or_else(|| {
            eprintln!("Warning: no enabled mock OAuth provider found in config, using defaults");
            ConfigOAuthProvider {
                name: "mock".to_string(),
                client_id: "mock-client".to_string(),
                client_secret: "mock-secret".to_string(),
                redirect_uri: "http://localhost:3000/auth/oauth/mock/callback".to_string(),
                issuer_url: Some("http://localhost:8080/plnd-dev".to_string()),
                internal_issuer_url: None,
                scopes: vec![
                    "openid".to_string(),
                    "email".to_string(),
                    "profile".to_string(),
                ],
                enabled: true,
            }
        });

    let callback_uri = mock_cfg.redirect_uri.clone();

    let frontend_callback = config
        .auth
        .frontend_callback_url
        .clone()
        .unwrap_or_else(|| "http://localhost:4200/auth/callback".to_string());

    let mock_provider = Arc::new(MockOAuthProvider::new(OAuthProviderConfig {
        name: mock_cfg.name,
        client_id: mock_cfg.client_id,
        client_secret: mock_cfg.client_secret,
        redirect_uri: callback_uri.clone(),
        issuer_url: mock_cfg.issuer_url,
        internal_issuer_url: mock_cfg.internal_issuer_url,
        scopes: mock_cfg.scopes,
        enabled: mock_cfg.enabled,
    }));

    // Derive CORS origin before frontend_callback is moved into AppState.
    // e.g. "http://localhost:4200/auth/callback" → "http://localhost:4200"
    let cors_origin: HeaderValue = frontend_callback
        .split('/')
        .take(3)
        .collect::<Vec<_>>()
        .join("/")
        .parse()
        .expect("invalid CORS origin derived from frontend_callback_url");

    let state = Arc::new(AppState {
        db: db_conn,
        jwt,
        session,
        mock_provider,
        callback_uri,
        frontend_callback,
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
        .route("/preferences/me", get(preferences::get_preferences))
        .route("/preferences/me", patch(preferences::patch_preferences))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let public = Router::new()
        .route("/health", get(health_check))
        .route("/ready", get(readiness_check))
        .route("/auth/oauth/mock/authorize", get(auth::oauth_authorize))
        .route("/auth/oauth/mock/callback", get(auth::oauth_callback));

    let app = public.merge(protected).with_state(state).layer(cors);

    let listener = tokio::net::TcpListener::bind(&config.api.base_url)
        .await
        .unwrap();
    println!("API server listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "OK"
}

async fn readiness_check(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ReadyStatus>, StatusCode> {
    match state.db.health_check().await {
        Ok(_) => Ok(Json(ReadyStatus {
            status: "ready".to_string(),
            database: "connected".to_string(),
            timestamp: Utc::now(),
        })),
        Err(e) => {
            eprintln!("Readiness check failed: {}", e);
            Err(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}
