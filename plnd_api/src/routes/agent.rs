use axum::{extract::State, http::StatusCode, Extension, Json};
use chrono::Utc;
use plnd_agent::{
    register_memory_tools, register_schedule_tools, AgentContext, ToolRegistry, UseCase,
};
use plnd_data::db::{MemoryStore, TaskStore};
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::jwt::Claims;
use crate::models::{TaskEntryRequest, TaskEntryResponse};
use crate::state::AppState;

/// POST /agent/task — parse free-text task input via the AI agent loop and schedule a task.
#[utoipa::path(
    post,
    path = "/agent/task",
    tag = "Agent",
    security(("bearer_auth" = [])),
    request_body = TaskEntryRequest,
    responses(
        (status = 200, description = "Task created", body = TaskEntryResponse),
        (status = 400, description = "Bad request — agent output unparseable"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn post_task(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<TaskEntryRequest>,
) -> Result<Json<TaskEntryResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool().clone();

    let memory_store = Arc::new(MemoryStore::new(pool.clone()));
    let task_store = Arc::new(TaskStore::new(pool));

    let mut tools = ToolRegistry::new();
    register_memory_tools(&mut tools, memory_store);
    register_schedule_tools(&mut tools, task_store);

    let today = Utc::now().format("%Y-%m-%d");
    let input = format!("[Today: {today}] {}", body.input);

    let ctx = AgentContext {
        user_id,
        use_case: UseCase::TaskEntry,
        input,
    };

    let output = state
        .agent
        .run(&ctx, tools)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let response: TaskEntryResponse =
        serde_json::from_str(&output.content).map_err(|_| StatusCode::BAD_REQUEST)?;

    Ok(Json(response))
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

#[cfg(test)]
mod tests {
    use crate::models::{TaskEntryRequest, TaskEntryResponse};

    #[test]
    fn task_entry_request_deserializes() {
        let json = r#"{"input": "remind me to take out the trash tonight"}"#;
        let req: TaskEntryRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.input, "remind me to take out the trash tonight");
    }

    #[test]
    fn task_entry_request_rejects_empty_json() {
        let json = r#"{}"#;
        let result: Result<TaskEntryRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn task_entry_response_deserializes() {
        let json = r#"{
            "actions_taken": ["created task 'Take out trash' scheduled at 2026-04-05T20:00:00Z"],
            "ui_signals": [],
            "confirmation": "Take out trash scheduled for tonight at 8:00 PM (15 min, low energy)."
        }"#;
        let resp: TaskEntryResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.actions_taken.len(), 1);
        assert_eq!(resp.ui_signals.len(), 0);
        assert!(!resp.confirmation.is_empty());
    }
}
