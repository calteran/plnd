use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::jwt::Claims;
use crate::db::{models::UserIngredientPref, user_ingredient_prefs};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct UpsertIngredientPrefBody {
    pub is_blocked: bool,
    pub notes: Option<String>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<UserIngredientPref>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    user_ingredient_prefs::list(state.db.get_pool(), user_id)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn upsert(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(catalog_ingredient_id): Path<Uuid>,
    Json(body): Json<UpsertIngredientPrefBody>,
) -> Result<Json<UserIngredientPref>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    user_ingredient_prefs::upsert(
        state.db.get_pool(),
        user_id,
        catalog_ingredient_id,
        body.is_blocked,
        body.notes.as_deref(),
    )
    .await
    .map(Json)
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(catalog_ingredient_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let deleted =
        user_ingredient_prefs::delete(state.db.get_pool(), user_id, catalog_ingredient_id)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}
