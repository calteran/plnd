use crate::api_response::UserResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use plnd_data::db;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
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
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn get_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    match db::users::find_by_id(pool, user_id).await.map_err(|e| {
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
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn patch_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<Json<UserResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if let Some(ref name) = body.display_name {
        if name.len() > 100 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    if let Some(ref url) = body.avatar_url {
        if url.len() > 500 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }

    let pool = state.db.get_pool();

    match db::users::update_profile(
        pool,
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
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn post_complete_onboarding(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();
    db::users::complete_onboarding(pool, user_id)
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
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn delete_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    let found = db::users::deactivate_user(pool, user_id)
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
