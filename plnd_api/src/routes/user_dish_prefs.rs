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
use plnd_data::db::{models::UserDishPrefDetail, user_dish_prefs};

fn is_unique_violation(e: &sqlx::Error) -> bool {
    let s = e.to_string().to_lowercase();
    s.contains("unique") || s.contains("duplicate key")
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<UserDishPrefDetail>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    user_dish_prefs::list(state.db.get_pool(), user_id)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn get_detail(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
) -> Result<Json<UserDishPrefDetail>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    user_dish_prefs::get(state.db.get_pool(), user_id, pref_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

#[derive(Deserialize)]
pub struct CreateDishBody {
    /// Link an existing catalog dish
    pub catalog_dish_id: Option<Uuid>,
    /// Create a personal dish from scratch
    pub name: Option<String>,
    pub instructions: Option<String>,
    pub prep_time_minutes: Option<i32>,
    pub cook_time_minutes: Option<i32>,
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateDishBody>,
) -> Result<(StatusCode, Json<UserDishPrefDetail>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if let Some(catalog_id) = body.catalog_dish_id {
        match user_dish_prefs::create_from_catalog(state.db.get_pool(), user_id, catalog_id).await {
            Ok(detail) => Ok((StatusCode::CREATED, Json(detail))),
            Err(e) if is_unique_violation(&e) => Err(StatusCode::CONFLICT),
            Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
        }
    } else if let Some(name) = body.name {
        let detail = user_dish_prefs::create_from_scratch(
            state.db.get_pool(),
            user_id,
            &name,
            body.instructions.as_deref(),
            body.prep_time_minutes,
            body.cook_time_minutes,
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok((StatusCode::CREATED, Json(detail)))
    } else {
        // Must provide either catalog_dish_id or name
        Err(StatusCode::UNPROCESSABLE_ENTITY)
    }
}

/// PATCH body for user dish preferences.
///
/// Metadata fields (rating, is_safe_food, is_blocked, notes) update the pref row.
/// Recipe fields (name, instructions, prep_time_minutes, cook_time_minutes) trigger a fork-and-update.
/// To explicitly clear rating or notes to NULL, send `"rating": null` / `"notes": null` in the JSON.
#[derive(Deserialize)]
pub struct PatchDishBody {
    // Metadata fields
    pub rating: Option<serde_json::Value>, // number or null
    pub is_safe_food: Option<bool>,
    pub is_blocked: Option<bool>,
    pub notes: Option<serde_json::Value>, // string or null
    // Recipe fields
    pub name: Option<String>,
    pub instructions: Option<serde_json::Value>, // string or null
    pub prep_time_minutes: Option<i32>,
    pub cook_time_minutes: Option<i32>,
}

pub async fn patch(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
    Json(body): Json<PatchDishBody>,
) -> Result<Json<UserDishPrefDetail>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let has_recipe_fields = body.name.is_some()
        || body.instructions.is_some()
        || body.prep_time_minutes.is_some()
        || body.cook_time_minutes.is_some();

    if has_recipe_fields {
        // Treat instructions value: null → clear, string → set, absent → keep
        let instructions: Option<&str> =
            body.instructions
                .as_ref()
                .and_then(|v| if v.is_null() { None } else { v.as_str() });

        user_dish_prefs::fork_and_update_recipe(
            state.db.get_pool(),
            user_id,
            pref_id,
            body.name.as_deref(),
            instructions,
            body.prep_time_minutes,
            body.cook_time_minutes,
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
    } else {
        // Metadata-only update
        // rating: Some(Value) means "was provided"; inner value may be null (→ None) or i64
        let rating: Option<Option<i16>> = body.rating.as_ref().map(|v| {
            if v.is_null() {
                None
            } else {
                v.as_i64().map(|n| n as i16)
            }
        });

        // notes: Some(Value) means "was provided"; inner value may be null (→ None) or string
        let notes: Option<Option<String>> = body.notes.as_ref().map(|v| {
            if v.is_null() {
                None
            } else {
                v.as_str().map(|s| s.to_string())
            }
        });

        user_dish_prefs::update_metadata(
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
    let deleted = user_dish_prefs::delete(state.db.get_pool(), user_id, pref_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

#[derive(Deserialize)]
pub struct AddIngredientBody {
    pub catalog_ingredient_id: Uuid,
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: Option<bool>,
    pub sort_order: Option<i16>,
}

pub async fn add_ingredient(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
    Json(body): Json<AddIngredientBody>,
) -> Result<Json<UserDishPrefDetail>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    user_dish_prefs::add_ingredient(
        state.db.get_pool(),
        user_id,
        pref_id,
        user_dish_prefs::AddIngredientParams {
            ingredient_id: body.catalog_ingredient_id,
            quantity: body.quantity,
            unit: body.unit,
            preparation_note: body.preparation_note,
            is_optional: body.is_optional.unwrap_or(false),
            sort_order: body.sort_order.unwrap_or(0),
        },
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map(Json)
    .ok_or(StatusCode::NOT_FOUND)
}

pub async fn remove_ingredient(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((pref_id, ingredient_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    match user_dish_prefs::remove_ingredient(state.db.get_pool(), user_id, pref_id, ingredient_id)
        .await
    {
        Ok(Some(true)) => Ok(StatusCode::NO_CONTENT),
        Ok(Some(false)) | Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}
