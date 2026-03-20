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

#[utoipa::path(
    get,
    path = "/preferences/me",
    tag = "Preferences",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "User preferences", body = UserPreferences),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
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
