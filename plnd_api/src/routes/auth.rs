use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    extract::{Extension, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Deserialize, Serialize)]
pub struct TokenExchangeRequest {
    pub id_token: String,
    /// The IdP provider name: "mock" | "google" | "apple"
    pub provider: String,
}

#[derive(Debug, Serialize)]
pub struct TokenExchangeResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: u64,
}

#[utoipa::path(
    post,
    path = "/auth/token",
    tag = "Auth",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, description = "Backend JWT issued successfully"),
        (status = 401, description = "ID token invalid or untrusted"),
        (status = 500, description = "Internal server error"),
    )
)]
/// POST /auth/token — exchange an IdP ID token for a backend JWT.
///
/// Angular obtains the ID token from the OIDC library after completing the
/// authorization code + PKCE flow. The backend validates the token via JWKS,
/// finds or creates the user, and issues a backend JWT bound to a session record.
#[tracing::instrument(skip_all)]
pub async fn token_exchange(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<TokenExchangeRequest>,
) -> Result<Json<TokenExchangeResponse>, StatusCode> {
    // 1. Validate the ID token's RS256 signature via the JWKS cache.
    let id_claims = state
        .jwks
        .validate_id_token(&req.id_token, &state.oidc_client_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "ID token validation failed");
            StatusCode::UNAUTHORIZED
        })?;

    // 2. Extract user attributes from ID token claims.
    let sub = &id_claims.sub;
    let email = id_claims
        .email
        .clone()
        .unwrap_or_else(|| format!("{}@mock.plnd", sub));
    let name = id_claims.name.as_deref();
    let picture = id_claims.picture.as_deref();

    // 3. Find or create the user, linking the OAuth provider identity.
    let user = match state
        .repos
        .user
        .find_by_provider(&req.provider, sub)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "provider lookup failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })? {
        Some(existing) => {
            let _ = state.repos.user.touch_last_login(existing.user_id).await;
            existing
        }
        None => {
            let user = match state.repos.user.find_by_email(&email).await.map_err(|e| {
                tracing::error!(error = %e, "email lookup failed");
                StatusCode::INTERNAL_SERVER_ERROR
            })? {
                Some(existing) => {
                    let _ = state.repos.user.touch_last_login(existing.user_id).await;
                    existing
                }
                None => state
                    .repos
                    .user
                    .create(&email, name, picture)
                    .await
                    .map_err(|e| {
                        tracing::error!(error = %e, "user creation failed");
                        StatusCode::INTERNAL_SERVER_ERROR
                    })?,
            };

            if let Err(e) = state
                .repos
                .user
                .link_oauth_provider(user.user_id, &req.provider, sub)
                .await
            {
                tracing::warn!(error = %e, "failed to link OAuth provider (non-fatal)");
            }

            user
        }
    };

    // 4. Issue the backend JWT.
    let jwt = state
        .jwt
        .generate_token(
            &user.user_id.to_string(),
            &user.email,
            user.display_name.as_deref(),
            user.avatar_url.as_deref(),
        )
        .map_err(|e| {
            tracing::error!(error = %e, "JWT generation failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // 5. Decode the backend JWT to extract the JTI for session binding.
    let backend_claims = state.jwt.validate_token(&jwt).map_err(|e| {
        tracing::error!(error = %e, "JWT self-validation failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // 6. Extract client metadata for the session record.
    let ip_string = headers
        .get("X-Forwarded-For")
        .or_else(|| headers.get("X-Real-IP"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string());
    let ua_string = headers
        .get("User-Agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // 7. Persist the session, binding the JTI so middleware can revoke it.
    let _ = state
        .session
        .create_session(
            &user.user_id.to_string(),
            &backend_claims.jti,
            ip_string.as_deref(),
            ua_string.as_deref(),
        )
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "session creation failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(TokenExchangeResponse {
        access_token: jwt,
        token_type: "Bearer".to_string(),
        expires_in: state.jwt.expiration(),
    }))
}

#[utoipa::path(
    post,
    path = "/auth/logout",
    tag = "Auth",
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Session revoked"),
        (status = 401, description = "Unauthorized"),
    )
)]
/// POST /auth/logout — revoke the current session by JTI.
///
/// The middleware has already validated the token and inserted Claims into
/// request extensions. We use the JTI from Claims to mark the session revoked,
/// so subsequent requests with the same JWT are rejected by the middleware.
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn logout(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> StatusCode {
    let _ = state.session.revoke_session(&claims.jti).await;
    StatusCode::NO_CONTENT
}
