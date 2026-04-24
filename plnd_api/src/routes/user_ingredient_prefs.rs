use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::api_response::UserIngredientPrefResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpsertIngredientPrefBody {
    /// −2=refuse, −1=tolerate, 0=neutral, +1=enjoy, +2=strongly prefer
    pub preference_score: i16,
    pub notes: Option<String>,
}

#[utoipa::path(
    get,
    path = "/my/ingredient-prefs",
    tag = "My Ingredient Prefs",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of user ingredient preferences", body = Vec<UserIngredientPrefResponse>),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<UserIngredientPrefResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .user_ingredient_pref
        .list(user_id)
        .await
        .map(|v| {
            Json(
                v.into_iter()
                    .map(UserIngredientPrefResponse::from)
                    .collect(),
            )
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[utoipa::path(
    put,
    path = "/my/ingredient-prefs/{id}",
    tag = "My Ingredient Prefs",
    params(
        ("id" = Uuid, Path, description = "Catalog ingredient ID")
    ),
    request_body = UpsertIngredientPrefBody,
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Created or updated ingredient preference", body = UserIngredientPrefResponse),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "preference_score out of range (must be -2..=2)"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn upsert(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(catalog_ingredient_id): Path<Uuid>,
    Json(body): Json<UpsertIngredientPrefBody>,
) -> Result<Json<UserIngredientPrefResponse>, StatusCode> {
    if !(-2..=2).contains(&body.preference_score) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .user_ingredient_pref
        .upsert(
            user_id,
            catalog_ingredient_id,
            body.preference_score,
            body.notes.as_deref(),
        )
        .await
        .map(UserIngredientPrefResponse::from)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[utoipa::path(
    delete,
    path = "/my/ingredient-prefs/{id}",
    tag = "My Ingredient Prefs",
    params(
        ("id" = Uuid, Path, description = "Catalog ingredient ID")
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Preference deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn delete(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(catalog_ingredient_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let deleted = state
        .repos
        .user_ingredient_pref
        .delete(user_id, catalog_ingredient_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}
