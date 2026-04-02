use crate::api_response::{
    PlanStatusApiResponse, PostSchedulePlanApiResponse, SchedulePeriodApiResponse,
};
use crate::auth::jwt::Claims;
use crate::models::{CarryoverDecision as HttpCarryoverDecision, PostSchedulePlanRequest};
use crate::state::AppState;
use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use plnd_data::db;
use plnd_data::db::models::{CarryoverDecision, CommitPlanInput, PlanEntryInput};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct PeriodQuery {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

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
pub async fn get_period(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<PeriodQuery>,
) -> Result<Json<SchedulePeriodApiResponse>, StatusCode> {
    if params.end < params.start {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::schedule::get_period(pool, user_id, params.start, params.end)
        .await
        .map(SchedulePeriodApiResponse::from)
        .map(Json)
        .map_err(|e| {
            eprintln!("get_period error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
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
pub async fn get_plan_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<PeriodQuery>,
) -> Result<Json<PlanStatusApiResponse>, StatusCode> {
    if params.end < params.start {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::schedule::get_plan_status(pool, user_id, params.start, params.end)
        .await
        .map(PlanStatusApiResponse::from)
        .map(Json)
        .map_err(|e| {
            eprintln!("get_plan_status error: {}", e);
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
pub async fn post_plan(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PostSchedulePlanRequest>,
) -> Result<Json<PostSchedulePlanApiResponse>, StatusCode> {
    if body.plan_end < body.plan_start {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    // Map from HTTP request type to DB-layer input type
    let entries = body
        .entries
        .into_iter()
        .map(|e| PlanEntryInput {
            date: e.date,
            task_type: e.task_type,
            task_ref_id: e.task_ref_id,
            task_ref_type: e.task_ref_type,
            title: e.title,
            scheduled_start: e.scheduled_start,
            after_milepost: e.after_milepost,
        })
        .collect();

    let carryover_decisions: HashMap<Uuid, CarryoverDecision> = body
        .carryover_decisions
        .into_iter()
        .map(|(id, d)| {
            let db_decision = match d {
                HttpCarryoverDecision::Accept => CarryoverDecision::Accept,
                HttpCarryoverDecision::Defer => CarryoverDecision::Defer,
                HttpCarryoverDecision::Dismiss => CarryoverDecision::Dismiss,
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
    };

    db::schedule::commit_plan(pool, user_id, &input)
        .await
        .map(PostSchedulePlanApiResponse::from)
        .map(Json)
        .map_err(|e| match e {
            plnd_data::db::error::DatabaseError::ValidationError(_) => StatusCode::BAD_REQUEST,
            _ => {
                eprintln!("post_plan error: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}
