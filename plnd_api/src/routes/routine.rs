use crate::api_response::RoutineResponse;
use crate::auth::jwt::Claims;
use crate::routes::domain_constants::{
    VALID_ENERGY_LEVELS, VALID_RECURRENCE_TYPES, VALID_TASK_TYPES,
};
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use chrono::NaiveTime;
use plnd_data::Error;
use std::sync::Arc;
use uuid::Uuid;

/// Returns 422 if `rule` does not begin with `FREQ=`.
/// Uppercase-only: RFC 5545 canonical form; the frontend always generates uppercase.
fn validate_recurrence_rule(rule: &str) -> Result<(), StatusCode> {
    if !rule.starts_with("FREQ=") {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    Ok(())
}

#[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
pub struct UpdateRoutineRequest {
    pub title: String,
    /// RRULE canonical string, required (e.g. "FREQ=DAILY").
    pub recurrence_rule: String,
    /// Curated recurrence enum — optional derived presentation hint.
    pub recurrence_tag: Option<String>,
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    pub duration_minutes: Option<i32>,
    /// Defaults to "medium" if omitted.
    pub energy_required: Option<String>,
    /// Defaults to false if omitted.
    pub is_anchor: Option<bool>,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
pub struct CreateRoutineRequest {
    pub task_type: String,
    pub title: String,
    /// RRULE canonical string, required (e.g. "FREQ=DAILY").
    pub recurrence_rule: String,
    /// Curated recurrence enum — optional derived presentation hint.
    pub recurrence_tag: Option<String>,
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    pub duration_minutes: Option<i32>,
    /// Defaults to "medium" if omitted.
    pub energy_required: Option<String>,
    /// Defaults to false if omitted.
    pub is_anchor: Option<bool>,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
}

#[utoipa::path(
    get,
    path = "/routines",
    tag = "Routines",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of routines for current user", body = Vec<RoutineResponse>),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn list_routines(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<RoutineResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .routine
        .list_routines_for_user(user_id)
        .await
        .map(|v| Json(v.into_iter().map(RoutineResponse::from).collect()))
        .map_err(|e| {
            tracing::error!(error = %e, "list_routines DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    post,
    path = "/routines",
    tag = "Routines",
    security(("bearer_auth" = [])),
    request_body = CreateRoutineRequest,
    responses(
        (status = 201, description = "Routine created", body = RoutineResponse),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Invalid task_type, recurrence, energy_required, recurrence_rule format, or empty title"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn create_routine(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateRoutineRequest>,
) -> Result<(StatusCode, Json<RoutineResponse>), StatusCode> {
    if body.title.trim().is_empty() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if !VALID_TASK_TYPES.contains(&body.task_type.as_str()) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    let energy = body.energy_required.as_deref().unwrap_or("medium");
    if !VALID_ENERGY_LEVELS.contains(&energy) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    validate_recurrence_rule(&body.recurrence_rule)?;
    if body
        .recurrence_tag
        .as_deref()
        .is_some_and(|tag| !VALID_RECURRENCE_TYPES.contains(&tag))
    {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .routine
        .create_routine(
            user_id,
            &body.task_type,
            &body.title,
            body.recurrence_tag.as_deref(),
            &body.recurrence_rule,
            body.time_window_start,
            body.time_window_end,
            body.duration_minutes,
            energy,
            body.is_anchor.unwrap_or(false),
            body.task_ref_id,
            body.task_ref_type.as_deref(),
        )
        .await
        .map(|t| (StatusCode::CREATED, Json(RoutineResponse::from(t))))
        .map_err(|e| match e {
            Error::Conflict => StatusCode::CONFLICT,
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "create_routine DB error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

#[utoipa::path(
    delete,
    path = "/routines/{id}",
    tag = "Routines",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Routine ID")),
    responses(
        (status = 204, description = "Routine deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Routine not found or not owned by current user"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn delete_routine(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(routine_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .routine
        .delete_routine(user_id, routine_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "delete_routine DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
        .and_then(|deleted| {
            if deleted {
                Ok(StatusCode::NO_CONTENT)
            } else {
                Err(StatusCode::NOT_FOUND)
            }
        })
}

#[utoipa::path(
    put,
    path = "/routines/{id}",
    tag = "Routines",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Routine ID")),
    request_body = UpdateRoutineRequest,
    responses(
        (status = 200, description = "Routine updated", body = RoutineResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Routine not found or not owned by current user"),
        (status = 422, description = "Invalid recurrence, energy_required, recurrence_rule format, or empty title"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn update_routine(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(routine_id): Path<Uuid>,
    Json(body): Json<UpdateRoutineRequest>,
) -> Result<Json<RoutineResponse>, StatusCode> {
    if body.title.trim().is_empty() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    let energy = body.energy_required.as_deref().unwrap_or("medium");
    if !VALID_ENERGY_LEVELS.contains(&energy) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    validate_recurrence_rule(&body.recurrence_rule)?;
    if body
        .recurrence_tag
        .as_deref()
        .is_some_and(|tag| !VALID_RECURRENCE_TYPES.contains(&tag))
    {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .routine
        .update_routine(
            routine_id,
            user_id,
            &body.title,
            body.recurrence_tag.as_deref(),
            &body.recurrence_rule,
            body.time_window_start,
            body.time_window_end,
            body.duration_minutes,
            energy,
            body.is_anchor.unwrap_or(false),
            body.task_ref_id,
            body.task_ref_type.as_deref(),
        )
        .await
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "update_routine DB error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?
        .map(|t| Json(RoutineResponse::from(t)))
        .ok_or(StatusCode::NOT_FOUND)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_task_types_matches_db_check_constraint() {
        for t in &[
            "exercise",
            "work",
            "leisure",
            "appointment",
            "medication",
            "general",
        ] {
            assert!(VALID_TASK_TYPES.contains(t), "missing task_type: {t}");
        }
        assert!(!VALID_TASK_TYPES.contains(&"meal"), "meal must not be a task type");
        assert!(!VALID_TASK_TYPES.contains(&"invalid"));
    }

    #[test]
    fn valid_recurrences_matches_db_check_constraint() {
        for r in &["daily", "weekdays", "weekly", "monthly", "yearly"] {
            assert!(
                VALID_RECURRENCE_TYPES.contains(r),
                "missing recurrence: {r}"
            );
        }
        assert!(!VALID_RECURRENCE_TYPES.contains(&"custom"));
        assert!(!VALID_RECURRENCE_TYPES.contains(&"biweekly"));
    }

    #[test]
    fn valid_energies_matches_db_check_constraint() {
        for e in &["low", "medium", "high"] {
            assert!(VALID_ENERGY_LEVELS.contains(e), "missing energy: {e}");
        }
        assert!(!VALID_ENERGY_LEVELS.contains(&"extreme"));
    }

    #[test]
    fn recurrence_rule_valid_rrule_accepted() {
        for rule in &[
            "FREQ=WEEKLY;BYDAY=MO,WE,FR",
            "FREQ=DAILY",
            "FREQ=MONTHLY;BYMONTHDAY=1",
        ] {
            assert!(
                validate_recurrence_rule(rule).is_ok(),
                "should accept: {rule}"
            );
        }
    }

    #[test]
    fn recurrence_rule_invalid_format_rejected() {
        for rule in &["garbage", "", "BYDAY=MO", "freq=weekly"] {
            assert!(
                validate_recurrence_rule(rule).is_err(),
                "should reject: {rule}"
            );
        }
    }
}
