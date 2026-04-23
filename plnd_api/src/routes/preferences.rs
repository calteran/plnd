use crate::api_response::UserPreferencesResponse;
use crate::auth::jwt::Claims;
use crate::models::PatchPreferencesRequest;
use crate::state::AppState;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

#[utoipa::path(
    patch,
    path = "/preferences/me",
    tag = "Preferences",
    request_body = PatchPreferencesRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Updated preferences", body = UserPreferencesResponse),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Validation error"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn patch_preferences(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PatchPreferencesRequest>,
) -> Result<Json<UserPreferencesResponse>, StatusCode> {
    if let Some(wsd) = body.week_start_day {
        if !(0..=6).contains(&wsd) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    if let Some(pto) = body.planning_trigger_offset {
        if !(-14..=14).contains(&pto) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    if let Some(lpd) = body.default_plan_length_days {
        if !(1..=90).contains(&lpd) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }

    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let any_scheduling = body.week_start_day.is_some()
        || body.planning_trigger_offset.is_some()
        || body.default_plan_length_days.is_some()
        || body.wake_time.is_some();

    if any_scheduling {
        state
            .repos
            .preferences
            .patch_preferences(
                user_id,
                body.week_start_day,
                body.planning_trigger_offset,
                body.default_plan_length_days,
                body.wake_time,
            )
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "patch_preferences error");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    }

    let any_window = body.breakfast_window_start.is_some()
        || body.breakfast_window_end.is_some()
        || body.lunch_window_start.is_some()
        || body.lunch_window_end.is_some()
        || body.dinner_window_start.is_some()
        || body.dinner_window_end.is_some();

    if any_window {
        state
            .repos
            .preferences
            .update_meal_windows(
                user_id,
                body.breakfast_window_start,
                body.breakfast_window_end,
                body.lunch_window_start,
                body.lunch_window_end,
                body.dinner_window_start,
                body.dinner_window_end,
            )
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "update_meal_windows error");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    }

    state
        .repos
        .preferences
        .get_or_create(user_id)
        .await
        .map(|p| Json(UserPreferencesResponse::from(p)))
        .map_err(|e| {
            tracing::error!(error = %e, "get_or_create preferences error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    get,
    path = "/preferences/me",
    tag = "Preferences",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "User preferences", body = UserPreferencesResponse),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn get_preferences(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserPreferencesResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .preferences
        .get_or_create(user_id)
        .await
        .map(|p| Json(UserPreferencesResponse::from(p)))
        .map_err(|e| {
            tracing::error!(error = %e, "get_preferences DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
