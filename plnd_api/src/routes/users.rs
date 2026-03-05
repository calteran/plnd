use crate::auth::jwt::Claims;
use crate::db;
use crate::db::models::User;
use crate::state::AppState;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, serde::Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub profile_picture_url: Option<String>,
}

/// GET /users/me — return the current user's profile
pub async fn get_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<User>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    match db::users::find_by_id(pool, user_id).await.map_err(|e| {
        eprintln!("get_me DB error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })? {
        Some(user) => Ok(Json(user)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// PATCH /users/me — update display_name and/or profile_picture_url
pub async fn patch_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<Json<User>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Validate field lengths
    if let Some(ref name) = body.display_name {
        if name.len() > 100 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    if let Some(ref url) = body.profile_picture_url {
        if url.len() > 500 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }

    let pool = state.db.get_pool();

    match db::users::update_profile(
        pool,
        user_id,
        body.display_name.as_deref(),
        body.profile_picture_url.as_deref(),
    )
    .await
    .map_err(|e| {
        eprintln!("patch_me DB error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })? {
        Some(user) => Ok(Json(user)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// DELETE /users/me — soft-deactivate the account, returns 204 No Content
pub async fn delete_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    let found = db::users::deactivate_user(pool, user_id)
        .await
        .map_err(|e| {
            eprintln!("delete_me DB error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if found {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}
