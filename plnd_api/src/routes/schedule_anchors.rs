//! Per-date meal anchor instance CRUD (issue #828).
//!
//! All four operations (`add`, `remove`, `rename`, `retime`) are exposed here.
//! Listing a date lazily materializes its instances from the active day-type
//! template; subsequent reads return whatever the user has shaped the date
//! into. Past-date edits are accepted and never trigger agent runs.

use crate::api_response::MealAnchorInstanceResponse;
use crate::auth::jwt::Claims;
use crate::models::{
    CreateScheduleAnchorRequest, ListScheduleAnchorsQuery, UpdateScheduleAnchorRequest,
};
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
};
use plnd_data::Error;
use std::sync::Arc;
use uuid::Uuid;

pub const MAX_NAME_LEN: usize = 200;
const DEFAULT_TOLERANCE_MINUTES: i32 = 60;

#[utoipa::path(
    get,
    path = "/schedule/anchors",
    tag = "Schedule Anchors",
    security(("bearer_auth" = [])),
    params(
        ("date" = chrono::NaiveDate, Query, description = "Date (YYYY-MM-DD) to list anchors for; lazy-materialized on first call"),
    ),
    responses(
        (status = 200, description = "Instances for the date (may be empty)", body = Vec<MealAnchorInstanceResponse>),
        (status = 400, description = "Missing or invalid date"),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub, date = %query.date))]
pub async fn list_for_date(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ListScheduleAnchorsQuery>,
) -> Result<Json<Vec<MealAnchorInstanceResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .meal_anchor_instance
        .materialize(user_id, query.date)
        .await
        .map(|v| {
            Json(
                v.into_iter()
                    .map(MealAnchorInstanceResponse::from)
                    .collect(),
            )
        })
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "list_schedule_anchors error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

#[utoipa::path(
    post,
    path = "/schedule/anchors",
    tag = "Schedule Anchors",
    security(("bearer_auth" = [])),
    request_body = CreateScheduleAnchorRequest,
    responses(
        (status = 201, description = "Anchor instance created", body = MealAnchorInstanceResponse),
        (status = 401, description = "Unauthorized"),
        (status = 409, description = "Duplicate name on this date"),
        (status = 422, description = "Validation error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub, date = %body.date))]
pub async fn create(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateScheduleAnchorRequest>,
) -> Result<(StatusCode, Json<MealAnchorInstanceResponse>), StatusCode> {
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
        .meal_anchor_instance
        .add(user_id, body.date, name, body.preferred_time, tolerance)
        .await
        .map(|i| {
            (
                StatusCode::CREATED,
                Json(MealAnchorInstanceResponse::from(i)),
            )
        })
        .map_err(|e| match e {
            Error::Conflict => StatusCode::CONFLICT,
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "create_schedule_anchor error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

#[utoipa::path(
    patch,
    path = "/schedule/anchors/{id}",
    tag = "Schedule Anchors",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Instance ID")),
    request_body = UpdateScheduleAnchorRequest,
    responses(
        (status = 200, description = "Anchor instance updated", body = MealAnchorInstanceResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 409, description = "Duplicate name on this date"),
        (status = 422, description = "No fields provided or validation error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub, id = %id))]
pub async fn update(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateScheduleAnchorRequest>,
) -> Result<Json<MealAnchorInstanceResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if body.name.is_none() && body.preferred_time.is_none() && body.tolerance_minutes.is_none() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if let Some(t) = body.tolerance_minutes
        && !(0..=720).contains(&t)
    {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let name_arg: Option<&str> = match body.name.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() && s.len() <= MAX_NAME_LEN => Some(s),
        Some(_) => return Err(StatusCode::UNPROCESSABLE_ENTITY),
        None => None,
    };

    let row = state
        .repos
        .meal_anchor_instance
        .update(
            id,
            user_id,
            name_arg,
            body.preferred_time,
            body.tolerance_minutes,
        )
        .await
        .map_err(map_repo_error)?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(MealAnchorInstanceResponse::from(row)))
}

#[utoipa::path(
    delete,
    path = "/schedule/anchors/{id}",
    tag = "Schedule Anchors",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Instance ID")),
    responses(
        (status = 204, description = "Anchor removed (cascade-deletes attached planned meal)"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub, id = %id))]
pub async fn delete(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let removed = state
        .repos
        .meal_anchor_instance
        .remove(id, user_id)
        .await
        .map_err(map_repo_error)?;
    if removed {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

fn map_repo_error(e: Error) -> StatusCode {
    match e {
        Error::Conflict => StatusCode::CONFLICT,
        Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
        e => {
            tracing::error!(error = %e, "schedule_anchors repo error");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}
