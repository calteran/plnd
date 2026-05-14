use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use rust_decimal::Decimal;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::api_response::UserMealPrefDetailResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use plnd_data::Error;
use plnd_data::repository::user_meal_pref::AddDishParams;

#[utoipa::path(
    get,
    path = "/my/meals",
    tag = "My Meals",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of user meal preferences", body = Vec<UserMealPrefDetailResponse>),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<UserMealPrefDetailResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .user_meal_pref
        .list(user_id)
        .await
        .map(|v| {
            Json(
                v.into_iter()
                    .map(UserMealPrefDetailResponse::from)
                    .collect(),
            )
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[utoipa::path(
    get,
    path = "/my/meals/{pref_id}",
    tag = "My Meals",
    params(
        ("pref_id" = Uuid, Path, description = "User meal preference ID")
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "User meal preference detail", body = UserMealPrefDetailResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn get_detail(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
) -> Result<Json<UserMealPrefDetailResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .user_meal_pref
        .get(user_id, pref_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(UserMealPrefDetailResponse::from)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// Link an existing catalog meal or create a personal meal from scratch.
/// Provide either `catalog_meal_id` OR `name` (not both).
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateMealBody {
    /// Link an existing catalog meal
    pub catalog_meal_id: Option<Uuid>,
    /// Create a personal meal from scratch
    pub name: Option<String>,
    pub description: Option<String>,
}

#[utoipa::path(
    post,
    path = "/my/meals",
    tag = "My Meals",
    request_body = CreateMealBody,
    security(("bearer_auth" = [])),
    responses(
        (status = 201, description = "Meal preference created", body = UserMealPrefDetailResponse),
        (status = 401, description = "Unauthorized"),
        (status = 409, description = "Already in library"),
        (status = 422, description = "Must provide catalog_meal_id or name"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn create(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateMealBody>,
) -> Result<(StatusCode, Json<UserMealPrefDetailResponse>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if let Some(catalog_id) = body.catalog_meal_id {
        match state
            .repos
            .user_meal_pref
            .create_from_catalog(user_id, catalog_id)
            .await
        {
            Ok(detail) => Ok((
                StatusCode::CREATED,
                Json(UserMealPrefDetailResponse::from(detail)),
            )),
            Err(Error::Conflict) => Err(StatusCode::CONFLICT),
            Err(Error::ConnectionLost) => Err(StatusCode::SERVICE_UNAVAILABLE),
            Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
        }
    } else if let Some(name) = body.name {
        let detail = state
            .repos
            .user_meal_pref
            .create_from_scratch(user_id, &name, body.description.as_deref())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok((
            StatusCode::CREATED,
            Json(UserMealPrefDetailResponse::from(detail)),
        ))
    } else {
        // Must provide either catalog_meal_id or name
        Err(StatusCode::UNPROCESSABLE_ENTITY)
    }
}

/// Update metadata or recipe fields for a meal preference.
///
/// Metadata fields update the pref row.
/// Recipe fields (name, description) trigger a fork-and-update of the meal record.
/// To explicitly clear description or notes to NULL, send `"description": null` / `"notes": null`.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PatchMealBody {
    // Metadata fields
    #[schema(value_type = Option<Object>)]
    pub rating: Option<serde_json::Value>, // number or null
    pub is_safe_food: Option<bool>,
    pub is_blocked: Option<bool>,
    #[schema(value_type = Option<Object>)]
    pub notes: Option<serde_json::Value>, // string or null
    // Recipe fields
    pub name: Option<String>,
    #[schema(value_type = Option<Object>)]
    pub description: Option<serde_json::Value>, // string or null
}

#[utoipa::path(
    patch,
    path = "/my/meals/{pref_id}",
    tag = "My Meals",
    params(
        ("pref_id" = Uuid, Path, description = "User meal preference ID")
    ),
    request_body = PatchMealBody,
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Updated meal preference", body = UserMealPrefDetailResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn patch(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
    Json(body): Json<PatchMealBody>,
) -> Result<Json<UserMealPrefDetailResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let has_recipe_fields = body.name.is_some() || body.description.is_some();

    if has_recipe_fields {
        // Treat description value: null → clear, string → set, absent → keep
        let description: Option<&str> = body
            .description
            .as_ref()
            .and_then(|v| if v.is_null() { None } else { v.as_str() });

        state
            .repos
            .user_meal_pref
            .fork_and_update_recipe(user_id, pref_id, body.name.as_deref(), description)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .map(UserMealPrefDetailResponse::from)
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

        state
            .repos
            .user_meal_pref
            .update_metadata(
                user_id,
                pref_id,
                rating,
                body.is_safe_food,
                body.is_blocked,
                notes,
            )
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .map(UserMealPrefDetailResponse::from)
            .map(Json)
            .ok_or(StatusCode::NOT_FOUND)
    }
}

#[utoipa::path(
    delete,
    path = "/my/meals/{pref_id}",
    tag = "My Meals",
    params(
        ("pref_id" = Uuid, Path, description = "User meal preference ID")
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Meal preference deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn delete(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let deleted = state
        .repos
        .user_meal_pref
        .delete(user_id, pref_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct AddDishBody {
    pub catalog_dish_id: Option<Uuid>,
    pub user_dish_pref_id: Option<Uuid>,
    #[schema(value_type = f64)]
    pub dish_servings: Decimal,
    pub notes: Option<String>,
    pub sort_order: Option<i16>,
}

#[utoipa::path(
    post,
    path = "/my/meals/{pref_id}/dishes",
    tag = "My Meals",
    params(
        ("pref_id" = Uuid, Path, description = "User meal preference ID")
    ),
    request_body = AddDishBody,
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Updated meal preference with new dish", body = UserMealPrefDetailResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 422, description = "Must provide catalog_dish_id or user_dish_pref_id"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn add_dish(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(pref_id): Path<Uuid>,
    Json(body): Json<AddDishBody>,
) -> Result<Json<UserMealPrefDetailResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Must provide at least one dish reference
    if body.catalog_dish_id.is_none() && body.user_dish_pref_id.is_none() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    state
        .repos
        .user_meal_pref
        .add_dish(
            user_id,
            pref_id,
            AddDishParams {
                catalog_dish_id: body.catalog_dish_id,
                user_dish_id: body.user_dish_pref_id,
                dish_servings: body.dish_servings,
                notes: body.notes,
                sort_order: body.sort_order.unwrap_or(0),
            },
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(UserMealPrefDetailResponse::from)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

#[utoipa::path(
    delete,
    path = "/my/meals/{pref_id}/dishes/{dish_id}",
    tag = "My Meals",
    params(
        ("pref_id" = Uuid, Path, description = "User meal preference ID"),
        ("dish_id" = Uuid, Path, description = "Meal-dish join ID to remove")
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Dish removed from meal"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn remove_dish(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((pref_id, dish_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    match state
        .repos
        .user_meal_pref
        .remove_dish(user_id, pref_id, dish_id)
        .await
    {
        Ok(Some(true)) => Ok(StatusCode::NO_CONTENT),
        Ok(Some(false)) | Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}
