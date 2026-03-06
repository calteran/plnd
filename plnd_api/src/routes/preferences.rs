use crate::auth::jwt::Claims;
use crate::db;
use crate::db::models::UserPreferences;
use crate::state::AppState;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, serde::Deserialize)]
pub struct UpdatePreferencesRequest {
    pub theme: Option<String>,
}

const VALID_THEMES: &[&str] = &["system", "light", "dark"];

/// GET /preferences/me — return the current user's preferences, creating defaults if absent
pub async fn get_preferences(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserPreferences>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::preferences::get_or_create(pool, user_id)
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("get_preferences DB error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

/// PATCH /preferences/me — update theme and/or other preferences
pub async fn patch_preferences(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdatePreferencesRequest>,
) -> Result<Json<UserPreferences>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if let Some(ref t) = body.theme {
        if !VALID_THEMES.contains(&t.as_str()) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }

    let pool = state.db.get_pool();

    db::preferences::upsert(pool, user_id, body.theme.as_deref())
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("patch_preferences DB error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
