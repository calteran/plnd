use crate::api_response::DayTypeResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use chrono::{NaiveDate, NaiveTime};
use plnd_data::{Error, repository::day_type::DeleteDayTypeOutcome};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

pub const MAX_NAME_LEN: usize = 200;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateDayTypeRequest {
    pub name: String,
    pub days_bitmask: i32,
    #[serde(deserialize_with = "crate::models::deserialize_hhmm")]
    pub wake_time: NaiveTime,
    #[serde(deserialize_with = "crate::models::deserialize_hhmm")]
    pub sleep_time: NaiveTime,
    pub is_cycle: bool,
    pub cycle_length: Option<i32>,
    pub anchor_date: Option<NaiveDate>,
}

/// Kept separate from `CreateDayTypeRequest` so PUT and POST can diverge independently.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateDayTypeRequest {
    pub name: String,
    pub days_bitmask: i32,
    #[serde(deserialize_with = "crate::models::deserialize_hhmm")]
    pub wake_time: NaiveTime,
    #[serde(deserialize_with = "crate::models::deserialize_hhmm")]
    pub sleep_time: NaiveTime,
    pub is_cycle: bool,
    pub cycle_length: Option<i32>,
    pub anchor_date: Option<NaiveDate>,
}

/// Validate name length and enforce XOR between bitmask and cycle (E.4).
fn validate_day_type_request(
    name: &str,
    days_bitmask: i32,
    is_cycle: bool,
    cycle_length: Option<i32>,
    anchor_date: Option<NaiveDate>,
) -> Result<(), StatusCode> {
    if name.trim().is_empty() || name.trim().len() > MAX_NAME_LEN {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if is_cycle {
        // E.4: cycle types must not carry a weekday bitmask
        if days_bitmask != 0 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
        if cycle_length.is_none() || anchor_date.is_none() {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
        if cycle_length.unwrap() <= 0 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    } else {
        if !(0..=127).contains(&days_bitmask) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
        if cycle_length.is_some() || anchor_date.is_some() {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    Ok(())
}

/// E.5: reject if the requested bitmask overlaps with any existing day type for this user.
/// Skipped for cycle types (days_bitmask = 0 guaranteed by validation).
async fn check_bitmask_no_overlap(
    state: &AppState,
    user_id: Uuid,
    days_bitmask: i32,
    exclude_id: Option<Uuid>,
) -> Result<(), StatusCode> {
    if days_bitmask == 0 {
        return Ok(());
    }
    let existing = state
        .repos
        .day_type
        .list_for_user(user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "overlap check: list_for_user failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    for dt in existing {
        if Some(dt.id) == exclude_id {
            continue;
        }
        if dt.days_bitmask & days_bitmask != 0 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    Ok(())
}

#[utoipa::path(
    get,
    path = "/day-types",
    tag = "Day Types",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of day types", body = Vec<DayTypeResponse>),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn list_day_types(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<DayTypeResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .day_type
        .list_for_user(user_id)
        .await
        .map(|v| Json(v.into_iter().map(DayTypeResponse::from).collect()))
        .map_err(|e| {
            tracing::error!(error = %e, "list_day_types DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    post,
    path = "/day-types",
    tag = "Day Types",
    security(("bearer_auth" = [])),
    request_body = CreateDayTypeRequest,
    responses(
        (status = 201, description = "Day type created", body = DayTypeResponse),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Validation error or bitmask overlap"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn create_day_type(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateDayTypeRequest>,
) -> Result<(StatusCode, Json<DayTypeResponse>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    validate_day_type_request(
        &body.name,
        body.days_bitmask,
        body.is_cycle,
        body.cycle_length,
        body.anchor_date,
    )?;

    check_bitmask_no_overlap(&state, user_id, body.days_bitmask, None).await?;

    state
        .repos
        .day_type
        .create(
            user_id,
            body.name.trim(),
            body.days_bitmask,
            body.wake_time,
            body.sleep_time,
            body.is_cycle,
            body.cycle_length,
            body.anchor_date,
        )
        .await
        .map(|dt| (StatusCode::CREATED, Json(DayTypeResponse::from(dt))))
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "create_day_type DB error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

#[utoipa::path(
    put,
    path = "/day-types/{id}",
    tag = "Day Types",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Day type ID")),
    request_body = UpdateDayTypeRequest,
    responses(
        (status = 200, description = "Updated day type", body = DayTypeResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Day type not found"),
        (status = 422, description = "Validation error or bitmask overlap"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn update_day_type(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(day_type_id): Path<Uuid>,
    Json(body): Json<UpdateDayTypeRequest>,
) -> Result<Json<DayTypeResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    validate_day_type_request(
        &body.name,
        body.days_bitmask,
        body.is_cycle,
        body.cycle_length,
        body.anchor_date,
    )?;

    check_bitmask_no_overlap(&state, user_id, body.days_bitmask, Some(day_type_id)).await?;

    state
        .repos
        .day_type
        .update(
            day_type_id,
            user_id,
            body.name.trim(),
            body.days_bitmask,
            body.wake_time,
            body.sleep_time,
            body.is_cycle,
            body.cycle_length,
            body.anchor_date,
        )
        .await
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "update_day_type DB error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?
        .map(|dt| Json(DayTypeResponse::from(dt)))
        .ok_or(StatusCode::NOT_FOUND)
}

#[utoipa::path(
    delete,
    path = "/day-types/{id}",
    tag = "Day Types",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Day type ID")),
    responses(
        (status = 204, description = "Day type deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Day type not found"),
        (status = 422, description = "Cannot delete the last day type"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn delete_day_type(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(day_type_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    match state.repos.day_type.delete(day_type_id, user_id).await {
        Ok(DeleteDayTypeOutcome::Deleted) => Ok(StatusCode::NO_CONTENT),
        Ok(DeleteDayTypeOutcome::NotFound) => Err(StatusCode::NOT_FOUND),
        Ok(DeleteDayTypeOutcome::LastType) => Err(StatusCode::UNPROCESSABLE_ENTITY),
        Err(Error::ConnectionLost) => Err(StatusCode::SERVICE_UNAVAILABLE),
        Err(e) => {
            tracing::error!(error = %e, "delete_day_type DB error");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
