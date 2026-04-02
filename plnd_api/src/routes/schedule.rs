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
use plnd_data::db::models::{
    CarryoverDecision, CommitPlanInput, PlanEntryInput, PlanStatusResponse,
    PostSchedulePlanResponse, SchedulePeriodResponse,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct PeriodQuery {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

pub async fn get_period(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<PeriodQuery>,
) -> Result<Json<SchedulePeriodResponse>, StatusCode> {
    if params.end < params.start {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::schedule::get_period(pool, user_id, params.start, params.end)
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("get_period error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

pub async fn get_plan_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<PeriodQuery>,
) -> Result<Json<PlanStatusResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::schedule::get_plan_status(pool, user_id, params.start, params.end)
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("get_plan_status error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

pub async fn post_plan(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PostSchedulePlanRequest>,
) -> Result<Json<PostSchedulePlanResponse>, StatusCode> {
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
        .map(Json)
        .map_err(|e| match e {
            plnd_data::db::error::DatabaseError::ValidationError(_) => StatusCode::BAD_REQUEST,
            _ => {
                eprintln!("post_plan error: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}
