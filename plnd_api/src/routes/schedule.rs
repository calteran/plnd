use crate::api_response::{
    CarryoverApiResponse, PlanStatusApiResponse, PostSchedulePlanApiResponse,
    SchedulePeriodApiResponse,
};
use crate::auth::jwt::Claims;
use crate::models::{
    CarryoverDecision as HttpCarryoverDecision, PatchEntryStatusRequest, PlanEntryRequest,
    PostSchedulePlanRequest,
};
use crate::routes::domain_constants::{VALID_ENERGY_LEVELS, VALID_TASK_TYPES};
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
};
use chrono::NaiveDate;
use plnd_data::Error;
use plnd_data::models::{CarryoverDecision, CommitPlanInput, PlanEntryInput};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct PeriodQuery {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

#[derive(Debug, Deserialize)]
pub struct CarryoverParams {
    pub before: NaiveDate,
}

// ---------------------------------------------------------------------------
// Entry mapping helper — shared by `entries` and `placed_tasks` fields
// ---------------------------------------------------------------------------

fn map_entry(e: PlanEntryRequest) -> Result<PlanEntryInput, StatusCode> {
    if let Some(ref tt) = e.task_type
        && !VALID_TASK_TYPES.contains(&tt.as_str())
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some(ref level) = e.energy_required
        && !VALID_ENERGY_LEVELS.contains(&level.as_str())
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(PlanEntryInput {
        date: e.date,
        task_type: e.task_type,
        task_ref_id: e.task_ref_id,
        task_ref_type: e.task_ref_type,
        title: e.title,
        scheduled_start: e.scheduled_start,
        after_anchor: e.after_anchor,
        duration_minutes: e
            .duration_minutes
            .map(|d| i32::try_from(d).map_err(|_| StatusCode::BAD_REQUEST))
            .transpose()?,
        energy_required: e.energy_required,
    })
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/schedule/period",
    tag = "Schedule",
    params(
        ("start" = NaiveDate, Query, description = "Period start date (YYYY-MM-DD)"),
        ("end" = NaiveDate, Query, description = "Period end date (YYYY-MM-DD)"),
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Schedule entries for the period", body = SchedulePeriodApiResponse),
        (status = 400, description = "end must be >= start"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn get_period(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<PeriodQuery>,
) -> Result<Json<SchedulePeriodApiResponse>, StatusCode> {
    if params.end < params.start {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .schedule
        .get_period(user_id, params.start, params.end)
        .await
        .map(SchedulePeriodApiResponse::from)
        .map(Json)
        .map_err(|e| {
            tracing::error!(error = %e, "get_period error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    get,
    path = "/schedule/plan/carryover",
    tag = "Schedule",
    params(
        ("before" = NaiveDate, Query, description = "Fetch all incomplete tasks before this date (YYYY-MM-DD)"),
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Carryover items", body = CarryoverApiResponse),
        (status = 400, description = "Missing or invalid 'before' parameter"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn get_plan_carryover(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<CarryoverParams>,
) -> Result<Json<CarryoverApiResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .schedule
        .get_carryover(user_id, params.before)
        .await
        .map(CarryoverApiResponse::from)
        .map(Json)
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            _ => {
                tracing::error!(error = %e, "get_plan_carryover error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

#[utoipa::path(
    get,
    path = "/schedule/plan/status",
    tag = "Schedule",
    params(
        ("start" = NaiveDate, Query, description = "Period start date (YYYY-MM-DD)"),
        ("end" = NaiveDate, Query, description = "Period end date (YYYY-MM-DD)"),
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Planning status for the period", body = PlanStatusApiResponse),
        (status = 400, description = "end must be >= start"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn get_plan_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<PeriodQuery>,
) -> Result<Json<PlanStatusApiResponse>, StatusCode> {
    if params.end < params.start {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .schedule
        .get_plan_status(user_id, params.start, params.end)
        .await
        .map(PlanStatusApiResponse::from)
        .map(Json)
        .map_err(|e| {
            tracing::error!(error = %e, "get_plan_status error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    post,
    path = "/schedule/plan",
    tag = "Schedule",
    request_body = PostSchedulePlanRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Plan committed", body = PostSchedulePlanApiResponse),
        (status = 400, description = "plan_end must be >= plan_start, or validation error"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn post_plan(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PostSchedulePlanRequest>,
) -> Result<Json<PostSchedulePlanApiResponse>, StatusCode> {
    if body.plan_end < body.plan_start || (body.plan_end - body.plan_start).num_days() > 366 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Map meal plan entries (AI-suggested meals)
    let mut entries = body
        .entries
        .into_iter()
        .map(map_entry)
        .collect::<Result<Vec<_>, _>>()?;

    // Merge AI-placed one-off tasks from the Task Placement Review step
    let placed = body
        .placed_tasks
        .into_iter()
        .map(map_entry)
        .collect::<Result<Vec<_>, _>>()?;
    entries.extend(placed);

    let carryover_decisions: HashMap<Uuid, CarryoverDecision> = body
        .carryover_decisions
        .into_iter()
        .map(|(id, d)| {
            let db_decision = match d {
                HttpCarryoverDecision::Carry => CarryoverDecision::Carry,
                HttpCarryoverDecision::Defer => CarryoverDecision::Defer,
                HttpCarryoverDecision::Drop => CarryoverDecision::Drop,
            };
            (id, db_decision)
        })
        .collect();

    let input = CommitPlanInput {
        plan_start: body.plan_start,
        plan_end: body.plan_end,
        planning_task_id: body.planning_task_id,
        entries,
        replace: body.replace.unwrap_or(false),
        carryover_decisions,
        drop_reasons: body.carryover_drop_reasons,
    };

    state
        .repos
        .schedule
        .commit_plan(user_id, &input)
        .await
        .map(PostSchedulePlanApiResponse::from)
        .map(Json)
        .map_err(|e| match e {
            Error::Validation(_) => StatusCode::BAD_REQUEST,
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            _ => {
                tracing::error!(error = %e, "post_plan error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

const VALID_STATUSES: &[&str] = &["planned", "in_progress", "completed", "skipped", "deferred"];

#[utoipa::path(
    patch,
    path = "/schedule/entries/{id}/status",
    tag = "Schedule",
    params(("id" = Uuid, Path, description = "Schedule entry ID")),
    request_body = PatchEntryStatusRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Status updated"),
        (status = 400, description = "Invalid status value"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Entry not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn patch_entry_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(entry_id): Path<Uuid>,
    Json(body): Json<PatchEntryStatusRequest>,
) -> Result<StatusCode, StatusCode> {
    if !VALID_STATUSES.contains(&body.status.as_str()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .schedule
        .update_entry_status(user_id, entry_id, &body.status)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| match e {
            Error::NotFound => StatusCode::NOT_FOUND,
            _ => {
                tracing::error!(error = %e, "patch_entry_status error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

// ---------------------------------------------------------------------------
// Unit tests for map_entry validation (no DB needed)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn base_entry() -> PlanEntryRequest {
        PlanEntryRequest {
            date: date(2026, 4, 27),
            task_type: Some("work".to_string()),
            task_ref_id: None,
            task_ref_type: None,
            title: Some("Test".to_string()),
            scheduled_start: None,
            after_anchor: None,
            duration_minutes: None,
            energy_required: None,
        }
    }

    #[test]
    fn map_entry_rejects_invalid_task_type() {
        let e = PlanEntryRequest {
            task_type: Some("invalid_type".to_string()),
            ..base_entry()
        };
        assert_eq!(map_entry(e).unwrap_err(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn map_entry_accepts_any_after_anchor() {
        for label in &["brunch", "morning snack", "post-workout", "start_of_day"] {
            let e = PlanEntryRequest {
                after_anchor: Some((*label).to_string()),
                ..base_entry()
            };
            assert!(
                map_entry(e).is_ok(),
                "after_anchor '{}' must be accepted",
                label
            );
        }
    }

    #[test]
    fn map_entry_rejects_invalid_energy_required() {
        let e = PlanEntryRequest {
            energy_required: Some("extreme".to_string()),
            ..base_entry()
        };
        assert_eq!(map_entry(e).unwrap_err(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn map_entry_accepts_valid_entry() {
        let e = PlanEntryRequest {
            task_type: None, // meal anchor entry — task_type omitted
            after_anchor: Some("lunch".to_string()),
            energy_required: Some("low".to_string()),
            ..base_entry()
        };
        assert!(map_entry(e).is_ok());
    }
}
