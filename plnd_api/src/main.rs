use axum::http::StatusCode;
use axum::{extract::State, routing::get, Json, Router};
use chrono::Utc;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

use plnd_api::auth::oauth::{MockOAuthProvider, OAuthProvider, OAuthProviderConfig};
use plnd_api::auth::{JwtService, SessionService};
use plnd_api::config;
use plnd_api::config::settings::OAuthProviderConfig as ConfigOAuthProvider;
use plnd_api::db;
use plnd_api::db::models::ReadyStatus;
use plnd_api::db::Database;

/// Shared application state available to all route handlers
#[derive(Clone)]
struct AppState {
    db: Database,
    jwt: JwtService,
    session: SessionService,
    mock_provider: Arc<MockOAuthProvider>,
    /// The redirect_uri registered with the mock OAuth server (points back to this API)
    callback_uri: String,
    /// Where to send the browser after a successful login (Angular frontend)
    frontend_callback: String,
}

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

    let state = Arc::new(AppState {
        db: db_conn,
        jwt,
        session,
        mock_provider,
        callback_uri,
        frontend_callback,
    });

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/ready", get(readiness_check))
        .route("/auth/oauth/mock/authorize", get(oauth_authorize))
        .route("/auth/oauth/mock/callback", get(oauth_callback))
        .with_state(state);

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

async fn oauth_authorize(
    State(state): State<Arc<AppState>>,
) -> Result<axum::response::Redirect, StatusCode> {
    let oauth_state = uuid::Uuid::new_v4().to_string();
    let auth_url = state
        .mock_provider
        .get_auth_url(&oauth_state, &state.callback_uri);
    Ok(axum::response::Redirect::to(&auth_url))
}

async fn oauth_callback(
    State(state): State<Arc<AppState>>,
    query: axum::extract::Query<HashMap<String, String>>,
) -> Result<axum::response::Redirect, StatusCode> {
    let code = query.get("code").ok_or(StatusCode::BAD_REQUEST)?;

    let oauth_token = state
        .mock_provider
        .exchange_code_for_token(code, &state.callback_uri)
        .await
        .map_err(|e| {
            eprintln!("Token exchange failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let user_info = state
        .mock_provider
        .get_user_info(&oauth_token)
        .await
        .map_err(|e| {
            eprintln!("User info fetch failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let sub = &user_info.sub;
    let pool = state.db.get_pool();

    // Look up user by OAuth provider sub — this is the correct OIDC identity key.
    // Email is not guaranteed by the spec and should not be the primary lookup.
    let user = match db::users::find_by_provider(pool, "mock", sub)
        .await
        .map_err(|e| {
            eprintln!("Provider lookup failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })? {
        Some(existing) => {
            let _ = db::users::touch_last_login(pool, existing.user_id).await;
            existing
        }
        None => {
            // New OAuth identity — look up by email if present, else synthesize one.
            let email = user_info
                .email
                .clone()
                .unwrap_or_else(|| format!("{}@mock.plnd", sub));

            let user = match db::users::find_by_email(pool, &email).await.map_err(|e| {
                eprintln!("Email lookup failed: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })? {
                Some(existing) => {
                    let _ = db::users::touch_last_login(pool, existing.user_id).await;
                    existing
                }
                None => db::users::create(
                    pool,
                    &email,
                    user_info.name.as_deref(),
                    user_info.picture.as_deref(),
                )
                .await
                .map_err(|e| {
                    eprintln!("User creation failed: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?,
            };

            // Link this OAuth identity to the user record for future logins.
            if let Err(e) = db::users::link_oauth_provider(pool, user.user_id, "mock", sub).await {
                eprintln!("Failed to link OAuth provider (non-fatal): {}", e);
            }

            user
        }
    };

    let jwt = state
        .jwt
        .generate_token(
            &user.user_id.to_string(),
            &user.email,
            user.display_name.as_deref(),
            user.profile_picture_url.as_deref(),
        )
        .map_err(|e| {
            eprintln!("JWT generation failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let token_hash = simple_hash(&jwt);

    let _session_id = state
        .session
        .create_session(&user.user_id.to_string(), &token_hash, None, None)
        .await
        .map_err(|e| {
            eprintln!("Session creation failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let redirect_url = format!("{}?token={}", state.frontend_callback, jwt);
    Ok(axum::response::Redirect::to(&redirect_url))
}

fn simple_hash(input: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    input.hash(&mut h);
    format!("{:016x}", h.finish())
}

#[allow(dead_code)]
async fn health_check_json() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}
