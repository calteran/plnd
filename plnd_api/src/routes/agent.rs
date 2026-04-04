use axum::{extract::State, http::StatusCode, Extension};
use std::sync::Arc;

use crate::auth::jwt::Claims;
use crate::state::AppState;

/// POST /agent/task — stub returning 501 until Phase 3.2 implements LLM-backed task parsing.
#[utoipa::path(
    post,
    path = "/agent/task",
    tag = "Agent",
    security(("bearer_auth" = [])),
    responses(
        (status = 501, description = "Not yet implemented — available in Phase 3.2"),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip(_state), fields(user_id = %claims.sub))]
pub async fn post_task(
    State(_state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

/// POST /agent/meal-plan — stub returning 501 until Phase 3.3 implements LLM-backed meal planning.
#[utoipa::path(
    post,
    path = "/agent/meal-plan",
    tag = "Agent",
    security(("bearer_auth" = [])),
    responses(
        (status = 501, description = "Not yet implemented — available in Phase 3.3"),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip(_state), fields(user_id = %claims.sub))]
pub async fn post_meal_plan(
    State(_state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}
