use crate::auth::jwt::Claims;
use crate::db;
use crate::db::models::{
    PlanStatusResponse, PostSchedulePlanRequest, PostSchedulePlanResponse, SchedulePeriodResponse,
};
use crate::state::AppState;
use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
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
        ("start" = NaiveDate, Query, description = "Start date"),
        ("end" = NaiveDate, Query, description = "End date")
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Schedule entries and carryover", body = SchedulePeriodResponse),
        (status = 400, description = "Invalid date range"),
        (status = 401, description = "Unauthorized"),
    )
)]
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

#[utoipa::path(
    get,
    path = "/schedule/plan/status",
    tag = "Schedule",
    params(
        ("start" = NaiveDate, Query, description = "Horizon start"),
        ("end" = NaiveDate, Query, description = "Horizon end")
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Plan status", body = PlanStatusResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
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

#[utoipa::path(
    post,
    path = "/schedule/plan",
    tag = "Schedule",
    request_body = PostSchedulePlanRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Plan committed", body = PostSchedulePlanResponse),
        (status = 400, description = "Invalid request"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
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

    db::schedule::commit_plan(pool, user_id, &body)
        .await
        .map(Json)
        .map_err(|e| match e {
            db::error::DatabaseError::ValidationError(_) => {
                StatusCode::BAD_REQUEST
            }
            _ => {
                eprintln!("post_plan error: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}
