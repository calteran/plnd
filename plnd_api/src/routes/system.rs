use crate::models::ReadyStatus;
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use chrono::Utc;
use std::sync::Arc;

#[utoipa::path(
    get,
    path = "/health",
    tag = "System",
    responses(
        (status = 200, description = "API is alive", body = String)
    )
)]
pub async fn health_check() -> &'static str {
    "OK"
}

#[utoipa::path(
    get,
    path = "/ready",
    tag = "System",
    responses(
        (status = 200, description = "All dependencies healthy", body = ReadyStatus),
        (status = 503, description = "A dependency is unavailable"),
    )
)]
pub async fn readiness_check(
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
