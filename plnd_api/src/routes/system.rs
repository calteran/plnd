use crate::models::ReadyStatus;
use crate::state::AppState;
use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use std::net::SocketAddr;
use chrono::Utc;
use serde::Deserialize;
use std::sync::Arc;

#[utoipa::path(
    get,
    path = "/health",
    tag = "System",
    responses(
        (status = 200, description = "API is alive", body = String)
    )
)]
#[tracing::instrument(skip_all)]
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
#[tracing::instrument(skip(state))]
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
            tracing::error!(error = %e, "readiness check failed");
            Err(StatusCode::SERVICE_UNAVAILABLE)
        }
    }
}

/// Payload sent by the Angular frontend to report client-side errors.
/// All fields except `message`, `timestamp`, and `user_agent` are optional.
#[derive(Debug, Deserialize)]
pub struct ClientErrorPayload {
    pub message: String,
    pub stack: Option<String>,
    pub url: Option<String>,
    /// `X-Request-ID` from a prior API call this error is correlated to.
    pub request_id: Option<String>,
    pub timestamp: String,
    pub user_agent: String,
}

/// POST /api/client_error
///
/// Accepts structured error reports from the Angular frontend and emits them
/// as `tracing::error!` events into the backend log stream.
///
/// Unauthenticated callers are rate-limited at 20 requests/minute per IP.
/// A valid backend JWT in the Authorization header bypasses the rate limit.
#[utoipa::path(
    post,
    path = "/client_error",
    tag = "System",
    request_body = inline(serde_json::Value),
    responses(
        (status = 204, description = "Error logged"),
        (status = 429, description = "Rate limit exceeded"),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn report_client_error(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<ClientErrorPayload>,
) -> StatusCode {
    // Determine if the caller has a valid backend JWT.
    let is_authenticated = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .and_then(|token| state.jwt.validate_token(token).ok())
        .is_some();

    if !is_authenticated {
        let ip = headers
            .get("X-Forwarded-For")
            .or_else(|| headers.get("X-Real-IP"))
            .and_then(|v| v.to_str().ok())
            .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
            .unwrap_or_else(|| peer_addr.ip().to_string());

        if state.client_error_limiter.check_key(&ip).is_err() {
            return StatusCode::TOO_MANY_REQUESTS;
        }
    }

    tracing::error!(
        message = %payload.message,
        stack = payload.stack.as_deref().unwrap_or(""),
        url = payload.url.as_deref().unwrap_or(""),
        request_id = payload.request_id.as_deref().unwrap_or(""),
        timestamp = %payload.timestamp,
        user_agent = %payload.user_agent,
        "client_error_reported"
    );

    StatusCode::NO_CONTENT
}
