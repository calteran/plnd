use axum::http::StatusCode;
use axum::{Extension, Json, Router, routing::get};
use chrono::Utc;
use std::env;

mod db;

use db::Database;
use db::models::ReadyStatus;

#[tokio::main]
async fn main() {
    // Initialize database connection
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://plnd:plnd_dev@localhost/plnd_dev".to_string());

    let db = match Database::new(&database_url).await {
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
        .layer(Extension(db));

    // Run it on localhost:3000
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
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
