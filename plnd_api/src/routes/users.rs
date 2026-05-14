use crate::api_response::UserResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
};
use std::sync::Arc;
use uuid::Uuid;
use veil::Redact;

#[derive(Redact, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[redact(all)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[utoipa::path(
    get,
    path = "/users/me",
    tag = "Users",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Current user profile", body = UserResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "User not found"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn get_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    match state.repos.user.find_by_id(user_id).await.map_err(|e| {
        tracing::error!(error = %e, "get_me DB error");
        StatusCode::INTERNAL_SERVER_ERROR
    })? {
        Some(user) => Ok(Json(UserResponse::from(user))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[utoipa::path(
    patch,
    path = "/users/me",
    tag = "Users",
    security(("bearer_auth" = [])),
    request_body = UpdateProfileRequest,
    responses(
        (status = 200, description = "Updated user profile", body = UserResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "User not found"),
        (status = 422, description = "Validation error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn patch_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<Json<UserResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if let Some(ref name) = body.display_name
        && name.len() > 100
    {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if let Some(ref url) = body.avatar_url
        && url.len() > 500
    {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    match state
        .repos
        .user
        .update_profile(
            user_id,
            body.display_name.as_deref(),
            body.avatar_url.as_deref(),
        )
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "patch_me DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })? {
        Some(user) => Ok(Json(UserResponse::from(user))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[utoipa::path(
    post,
    path = "/users/me/complete-onboarding",
    tag = "Users",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Onboarding marked complete"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn post_complete_onboarding(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .user
        .complete_onboarding(user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "complete_onboarding error");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(StatusCode::OK)
}

#[utoipa::path(
    delete,
    path = "/users/me",
    tag = "Users",
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Account deactivated"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "User not found"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn delete_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let found = state
        .repos
        .user
        .deactivate_user(user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "delete_me DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if found {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_profile_request_debug_redacts_pii() {
        let req = UpdateProfileRequest {
            display_name: Some("Jane Doe".to_string()),
            avatar_url: Some("https://example.com/photo.jpg".to_string()),
        };
        let debug = format!("{:?}", req);

        assert!(!debug.contains("Jane Doe"), "display_name leaked: {debug}");
        assert!(!debug.contains("photo.jpg"), "avatar_url leaked: {debug}");
    }
}
