use crate::api_response::TaskResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use plnd_data::db;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct WeeklyPlanQuery {
    pub plan_start: NaiveDate,
}

#[utoipa::path(
    post,
    path = "/tasks/weekly-plan",
    tag = "Tasks",
    params(
        ("plan_start" = NaiveDate, Query, description = "Start date of the planning week (YYYY-MM-DD)")
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Planning task created or returned", body = TaskResponse),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn post_weekly_plan_task(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<WeeklyPlanQuery>,
) -> Result<Json<TaskResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    // Read trigger_offset from the user's stored preferences (not client-supplied)
    let prefs = db::preferences::get_or_create(pool, user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "weekly plan task: get_prefs error");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    db::tasks::create_weekly_plan_task(
        pool,
        user_id,
        params.plan_start,
        prefs.planning_trigger_offset,
    )
    .await
    .map(TaskResponse::from)
    .map(Json)
    .map_err(|e| {
        tracing::error!(error = %e, "weekly plan task: post error");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}
