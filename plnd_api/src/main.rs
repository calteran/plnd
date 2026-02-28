use axum::http::StatusCode;
use axum::{routing::get, Extension, Json, Router};
use chrono::Utc;
use serde_json::json;

mod config;
mod db;

use db::models::ReadyStatus;
use db::Database;

#[tokio::main]
async fn main() {
    // Load configuration
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

    // Initialize database connection using config
    let db = match Database::new(&config.database.url).await {
        Ok(db) => db,
        Err(e) => {
            eprintln!("Failed to connect to database: {}", e);
            std::process::exit(1);
        }
    };

    // Build our application with routes
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/ready", get(readiness_check))
        .route("/auth/oauth/mock/authorize", get(oauth_authorize))
        .route("/auth/oauth/mock/callback", get(oauth_callback))
        .layer(Extension(db));

    // Run it using configured address
    let listener = tokio::net::TcpListener::bind(&config.api.base_url)
        .await
        .unwrap();
    println!("API server listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

// Health check endpoint - simple server liveness
async fn health_check() -> &'static str {
    "OK"
}

// Readiness check endpoint - verifies database connectivity
async fn readiness_check(
    Extension(db): Extension<Database>,
) -> Result<Json<ReadyStatus>, StatusCode> {
    match db.health_check().await {
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

// OAuth authorization endpoint
async fn oauth_authorize() -> Result<axum::response::Redirect, StatusCode> {
    // For now, return a simple redirect to the mock OAuth server
    // In a real implementation, this would use the provider from extensions
    Ok(axum::response::Redirect::to("http://localhost:8080/authorize?response_type=code&client_id=mock-client&redirect_uri=http://localhost:4200/auth/mock/callback&state=test&scope=openid%20email%20profile"))
}

// OAuth callback endpoint
async fn oauth_callback(
    query: axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Extract code from query parameters
    let _code = query.get("code").ok_or(StatusCode::BAD_REQUEST)?;

    // For now, return a mock response
    // In a real implementation, this would exchange the code for a token
    Ok(Json(json!({
        "token": "mock-jwt-token",
        "user": {
            "sub": "user1",
            "email": "testuser@example.com",
            "name": "Test User"
        }
    })))
}
