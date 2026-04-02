use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use rust_decimal::Decimal;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::jwt::Claims;
use crate::state::AppState;
use plnd_data::db::{error::DatabaseError, models::UserMealPrefDetail, user_meal_prefs};

pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<UserMealPrefDetail>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    user_meal_prefs::list(state.db.get_pool(), user_id)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn get_detail(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
) -> Result<Json<UserMealPrefDetail>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    user_meal_prefs::get(state.db.get_pool(), user_id, pref_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

#[derive(Deserialize)]
pub struct CreateMealBody {
    /// Link an existing catalog meal
    pub catalog_meal_id: Option<Uuid>,
    /// Create a personal meal from scratch
    pub name: Option<String>,
    pub description: Option<String>,
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateMealBody>,
) -> Result<(StatusCode, Json<UserMealPrefDetail>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if let Some(catalog_id) = body.catalog_meal_id {
        match user_meal_prefs::create_from_catalog(state.db.get_pool(), user_id, catalog_id).await {
            Ok(detail) => Ok((StatusCode::CREATED, Json(detail))),
            Err(DatabaseError::UniqueViolation) => Err(StatusCode::CONFLICT),
            Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
        }
    } else if let Some(name) = body.name {
        let detail = user_meal_prefs::create_from_scratch(
            state.db.get_pool(),
            user_id,
            &name,
            body.description.as_deref(),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok((StatusCode::CREATED, Json(detail)))
    } else {
        // Must provide either catalog_meal_id or name
        Err(StatusCode::UNPROCESSABLE_ENTITY)
    }
}

/// PATCH body for user meal preferences.
///
/// Metadata fields update the pref row.
/// Recipe fields (name, description) trigger a fork-and-update of the meal record.
/// To explicitly clear description or notes to NULL, send `"description": null` / `"notes": null`.
#[derive(Deserialize)]
pub struct PatchMealBody {
    // Metadata fields
    pub rating: Option<serde_json::Value>, // number or null
    pub is_safe_food: Option<bool>,
    pub is_blocked: Option<bool>,
    pub notes: Option<serde_json::Value>, // string or null
    // Recipe fields
    pub name: Option<String>,
    pub description: Option<serde_json::Value>, // string or null
}

pub async fn patch(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
    Json(body): Json<PatchMealBody>,
) -> Result<Json<UserMealPrefDetail>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let has_recipe_fields = body.name.is_some() || body.description.is_some();

    if has_recipe_fields {
        // Treat description value: null → clear, string → set, absent → keep
        let description: Option<&str> =
            body.description
                .as_ref()
                .and_then(|v| if v.is_null() { None } else { v.as_str() });

        user_meal_prefs::fork_and_update_recipe(
            state.db.get_pool(),
            user_id,
            pref_id,
            body.name.as_deref(),
            description,
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
    } else {
        // Metadata-only update
        let rating: Option<Option<i16>> = body.rating.as_ref().map(|v| {
            if v.is_null() {
                None
            } else {
                v.as_i64().map(|n| n as i16)
            }
        });

        let notes: Option<Option<String>> = body.notes.as_ref().map(|v| {
            if v.is_null() {
                None
            } else {
                v.as_str().map(|s| s.to_string())
            }
        });

        user_meal_prefs::update_metadata(
            state.db.get_pool(),
            user_id,
            pref_id,
            rating,
            body.is_safe_food,
            body.is_blocked,
            notes,
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
    }
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let deleted = user_meal_prefs::delete(state.db.get_pool(), user_id, pref_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

#[derive(Deserialize)]
pub struct AddDishBody {
    pub catalog_dish_id: Option<Uuid>,
    pub user_dish_pref_id: Option<Uuid>,
    pub dish_servings: Decimal,
    pub notes: Option<String>,
    pub sort_order: Option<i16>,
}

pub async fn add_dish(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
    Json(body): Json<AddDishBody>,
) -> Result<Json<UserMealPrefDetail>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Must provide at least one dish reference
    if body.catalog_dish_id.is_none() && body.user_dish_pref_id.is_none() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    user_meal_prefs::add_dish(
        state.db.get_pool(),
        user_id,
        pref_id,
        user_meal_prefs::AddDishParams {
            catalog_dish_id: body.catalog_dish_id,
            user_dish_id: body.user_dish_pref_id,
            dish_servings: body.dish_servings,
            notes: body.notes,
            sort_order: body.sort_order.unwrap_or(0),
        },
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map(Json)
    .ok_or(StatusCode::NOT_FOUND)
}

pub async fn remove_dish(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((pref_id, dish_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    match user_meal_prefs::remove_dish(state.db.get_pool(), user_id, pref_id, dish_id).await {
        Ok(Some(true)) => Ok(StatusCode::NO_CONTENT),
        Ok(Some(false)) | Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}
