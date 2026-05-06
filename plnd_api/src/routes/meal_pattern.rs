use crate::api_response::MealPatternEntryResponse;
use crate::auth::jwt::Claims;
use crate::models::{CreateMealPatternEntryRequest, UpdateMealPatternEntryRequest};
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use plnd_data::Error;
use std::sync::Arc;
use uuid::Uuid;

pub const MAX_NAME_LEN: usize = 200;
const DEFAULT_TOLERANCE_MINUTES: i32 = 60;

#[utoipa::path(get, path = "/meal-pattern", tag = "Meal Pattern",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Meal pattern entries ordered by sort_order", body = Vec<MealPatternEntryResponse>),
        (status = 401, description = "Unauthorized"),
    ))]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn list_meal_pattern(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<MealPatternEntryResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .meal_pattern
        .list_for_user(user_id)
        .await
        .map(|v| Json(v.into_iter().map(MealPatternEntryResponse::from).collect()))
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "list_meal_pattern error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

#[utoipa::path(post, path = "/meal-pattern", tag = "Meal Pattern",
    security(("bearer_auth" = [])),
    request_body = CreateMealPatternEntryRequest,
    responses(
        (status = 201, description = "Entry created", body = MealPatternEntryResponse),
        (status = 401, description = "Unauthorized"),
        (status = 409, description = "Duplicate name or sort_order for this user"),
        (status = 422, description = "Validation error"),
    ))]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn create_meal_pattern_entry(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateMealPatternEntryRequest>,
) -> Result<(StatusCode, Json<MealPatternEntryResponse>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let name = body.name.trim();
    if name.is_empty() || name.len() > MAX_NAME_LEN {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    let tolerance = body.tolerance_minutes.unwrap_or(DEFAULT_TOLERANCE_MINUTES);
    if !(0..=720).contains(&tolerance) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    state
        .repos
        .meal_pattern
        .create(
            user_id,
            name,
            body.preferred_time,
            tolerance,
            body.sort_order,
        )
        .await
        .map(|e| (StatusCode::CREATED, Json(MealPatternEntryResponse::from(e))))
        .map_err(|e| match e {
            Error::Conflict => StatusCode::CONFLICT,
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "create_meal_pattern_entry error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

#[utoipa::path(patch, path = "/meal-pattern/{id}", tag = "Meal Pattern",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Entry ID")),
    request_body = UpdateMealPatternEntryRequest,
    responses(
        (status = 200, description = "Entry updated", body = MealPatternEntryResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 409, description = "Duplicate name or sort_order for this user"),
        (status = 422, description = "No fields provided or validation error"),
    ))]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn update_meal_pattern_entry(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(entry_id): Path<Uuid>,
    Json(body): Json<UpdateMealPatternEntryRequest>,
) -> Result<Json<MealPatternEntryResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if body.name.is_none()
        && body.preferred_time.is_none()
        && body.tolerance_minutes.is_none()
        && body.sort_order.is_none()
    {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    if let Some(t) = body.tolerance_minutes
        && !(0..=720).contains(&t)
    {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let existing = state
        .repos
        .meal_pattern
        .get_by_id(entry_id, user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let name = body.name.as_deref().unwrap_or(&existing.name);
    let name = name.trim();
    if name.is_empty() || name.len() > MAX_NAME_LEN {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    state
        .repos
        .meal_pattern
        .update(
            entry_id,
            user_id,
            name,
            body.preferred_time.unwrap_or(existing.preferred_time),
            body.tolerance_minutes.unwrap_or(existing.tolerance_minutes),
            body.sort_order.unwrap_or(existing.sort_order),
        )
        .await
        .map_err(|e| match e {
            Error::Conflict => StatusCode::CONFLICT,
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "update_meal_pattern_entry error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?
        .map(|e| Json(MealPatternEntryResponse::from(e)))
        .ok_or(StatusCode::NOT_FOUND)
}

#[utoipa::path(delete, path = "/meal-pattern/{id}", tag = "Meal Pattern",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Entry ID")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
    ))]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn delete_meal_pattern_entry(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(entry_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .meal_pattern
        .delete(entry_id, user_id)
        .await
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "delete_meal_pattern_entry error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
        .and_then(|deleted| {
            if deleted {
                Ok(StatusCode::NO_CONTENT)
            } else {
                Err(StatusCode::NOT_FOUND)
            }
        })
}
