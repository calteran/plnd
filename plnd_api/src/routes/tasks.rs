use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use plnd_data::db;
use plnd_data::db::models::Task;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct WeeklyPlanQuery {
    pub plan_start: NaiveDate,
}

pub async fn post_weekly_plan_task(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<WeeklyPlanQuery>,
) -> Result<Json<Task>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    // Read trigger_offset from the user's stored preferences (not client-supplied)
    let prefs = db::preferences::get_or_create(pool, user_id)
        .await
        .map_err(|e| {
            eprintln!("post_weekly_plan_task get_prefs error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    db::tasks::create_weekly_plan_task(
        pool,
        user_id,
        params.plan_start,
        prefs.planning_trigger_offset,
    )
    .await
    .map(Json)
    .map_err(|e| {
        eprintln!("post_weekly_plan_task error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })
}
