use crate::api_response::ScheduleTypeResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use chrono::{NaiveDate, NaiveTime};
use plnd_data::{repository::schedule_type::DeleteScheduleTypeOutcome, Error};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

pub const MAX_NAME_LEN: usize = 200;

fn deserialize_hhmm<'de, D>(deserializer: D) -> Result<NaiveTime, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    NaiveTime::parse_from_str(&s, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(&s, "%H:%M:%S"))
        .map_err(serde::de::Error::custom)
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateScheduleTypeRequest {
    pub name: String,
    pub days_bitmask: i32,
    #[serde(deserialize_with = "deserialize_hhmm")]
    pub wake_time: NaiveTime,
    #[serde(deserialize_with = "deserialize_hhmm")]
    pub bed_time: NaiveTime,
    pub is_cycle: bool,
    pub cycle_length: Option<i32>,
    pub anchor_date: Option<NaiveDate>,
}

/// Kept separate from `CreateScheduleTypeRequest` so PUT and POST can diverge independently
/// (e.g. partial updates, additional fields) without a breaking schema change.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateScheduleTypeRequest {
    pub name: String,
    pub days_bitmask: i32,
    #[serde(deserialize_with = "deserialize_hhmm")]
    pub wake_time: NaiveTime,
    #[serde(deserialize_with = "deserialize_hhmm")]
    pub bed_time: NaiveTime,
    pub is_cycle: bool,
    pub cycle_length: Option<i32>,
    pub anchor_date: Option<NaiveDate>,
}

fn validate_schedule_type_request(
    name: &str,
    days_bitmask: i32,
    is_cycle: bool,
    cycle_length: Option<i32>,
    anchor_date: Option<NaiveDate>,
) -> Result<(), StatusCode> {
    if name.trim().is_empty() || name.trim().len() > MAX_NAME_LEN {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if !(0..=127).contains(&days_bitmask) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if is_cycle {
        if cycle_length.is_none() || anchor_date.is_none() {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
        if cycle_length.unwrap() <= 0 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    } else if cycle_length.is_some() || anchor_date.is_some() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    Ok(())
}

#[utoipa::path(
    get,
    path = "/schedule-types",
    tag = "Schedule Types",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of schedule types", body = Vec<ScheduleTypeResponse>),
        (status = 401, description = "Unauthorized"),
    )
)]
/// GET /schedule-types — list all schedule types for the current user
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn list_schedule_types(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<ScheduleTypeResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .schedule_type
        .list_for_user(user_id)
        .await
        .map(|v| Json(v.into_iter().map(ScheduleTypeResponse::from).collect()))
        .map_err(|e| {
            tracing::error!(error = %e, "list_schedule_types DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    post,
    path = "/schedule-types",
    tag = "Schedule Types",
    security(("bearer_auth" = [])),
    request_body = CreateScheduleTypeRequest,
    responses(
        (status = 201, description = "Schedule type created", body = ScheduleTypeResponse),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Validation error"),
    )
)]
/// POST /schedule-types — create a new schedule type
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn create_schedule_type(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateScheduleTypeRequest>,
) -> Result<(StatusCode, Json<ScheduleTypeResponse>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    validate_schedule_type_request(
        &body.name,
        body.days_bitmask,
        body.is_cycle,
        body.cycle_length,
        body.anchor_date,
    )?;

    state
        .repos
        .schedule_type
        .create(
            user_id,
            body.name.trim(),
            body.days_bitmask,
            body.wake_time,
            body.bed_time,
            body.is_cycle,
            body.cycle_length,
            body.anchor_date,
        )
        .await
        .map(|st| (StatusCode::CREATED, Json(ScheduleTypeResponse::from(st))))
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "create_schedule_type DB error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

#[utoipa::path(
    put,
    path = "/schedule-types/{id}",
    tag = "Schedule Types",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Schedule type ID")),
    request_body = UpdateScheduleTypeRequest,
    responses(
        (status = 200, description = "Updated schedule type", body = ScheduleTypeResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Schedule type not found"),
        (status = 422, description = "Validation error"),
    )
)]
/// PUT /schedule-types/{id} — replace all fields of an existing schedule type
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn update_schedule_type(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(schedule_type_id): Path<Uuid>,
    Json(body): Json<UpdateScheduleTypeRequest>,
) -> Result<Json<ScheduleTypeResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    validate_schedule_type_request(
        &body.name,
        body.days_bitmask,
        body.is_cycle,
        body.cycle_length,
        body.anchor_date,
    )?;

    state
        .repos
        .schedule_type
        .update(
            schedule_type_id,
            user_id,
            body.name.trim(),
            body.days_bitmask,
            body.wake_time,
            body.bed_time,
            body.is_cycle,
            body.cycle_length,
            body.anchor_date,
        )
        .await
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "update_schedule_type DB error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?
        .map(|st| Json(ScheduleTypeResponse::from(st)))
        .ok_or(StatusCode::NOT_FOUND)
}

#[utoipa::path(
    delete,
    path = "/schedule-types/{id}",
    tag = "Schedule Types",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Schedule type ID")),
    responses(
        (status = 204, description = "Schedule type deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Schedule type not found"),
        (status = 422, description = "Cannot delete the last schedule type"),
    )
)]
/// DELETE /schedule-types/{id} — remove a schedule type (rejected if it is the user's only one)
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn delete_schedule_type(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(schedule_type_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    match state
        .repos
        .schedule_type
        .delete(schedule_type_id, user_id)
        .await
    {
        Ok(DeleteScheduleTypeOutcome::Deleted) => Ok(StatusCode::NO_CONTENT),
        Ok(DeleteScheduleTypeOutcome::NotFound) => Err(StatusCode::NOT_FOUND),
        Ok(DeleteScheduleTypeOutcome::LastType) => Err(StatusCode::UNPROCESSABLE_ENTITY),
        Err(Error::ConnectionLost) => Err(StatusCode::SERVICE_UNAVAILABLE),
        Err(e) => {
            tracing::error!(error = %e, "delete_schedule_type DB error");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
