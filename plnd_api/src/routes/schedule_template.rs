use crate::api_response::ScheduleTemplateResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveTime;
use std::sync::Arc;
use uuid::Uuid;

pub const VALID_TASK_TYPES: &[&str] = &[
    "meal", "exercise", "work", "leisure", "appointment", "medication", "custom",
];
pub const VALID_RECURRENCES: &[&str] = &["daily", "weekdays", "weekly", "custom"];
pub const VALID_ENERGIES: &[&str] = &["low", "medium", "high"];

#[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
pub struct CreateScheduleTemplateRequest {
    pub task_type: String,
    pub title: String,
    pub recurrence: String,
    pub recurrence_rule: Option<String>,
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    pub duration_minutes: Option<i32>,
    /// Defaults to "medium" if omitted.
    pub energy_required: Option<String>,
    /// Defaults to false if omitted.
    pub is_milepost: Option<bool>,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
}

#[utoipa::path(
    get,
    path = "/schedule/templates",
    tag = "Schedule Templates",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of schedule templates for current user", body = Vec<ScheduleTemplateResponse>),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn list_templates(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<ScheduleTemplateResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .schedule_template
        .list_templates_for_user(user_id)
        .await
        .map(|v| Json(v.into_iter().map(ScheduleTemplateResponse::from).collect()))
        .map_err(|e| {
            tracing::error!(error = %e, "list_templates DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    post,
    path = "/schedule/templates",
    tag = "Schedule Templates",
    security(("bearer_auth" = [])),
    request_body = CreateScheduleTemplateRequest,
    responses(
        (status = 201, description = "Template created", body = ScheduleTemplateResponse),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Invalid task_type, recurrence, energy_required, or empty title"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn create_template(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateScheduleTemplateRequest>,
) -> Result<(StatusCode, Json<ScheduleTemplateResponse>), StatusCode> {
    if body.title.trim().is_empty() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if !VALID_TASK_TYPES.contains(&body.task_type.as_str()) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if !VALID_RECURRENCES.contains(&body.recurrence.as_str()) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    let energy = body.energy_required.as_deref().unwrap_or("medium");
    if !VALID_ENERGIES.contains(&energy) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .schedule_template
        .create_template(
            user_id,
            &body.task_type,
            &body.title,
            &body.recurrence,
            body.recurrence_rule.as_deref(),
            body.time_window_start,
            body.time_window_end,
            body.duration_minutes,
            energy,
            body.is_milepost.unwrap_or(false),
            body.task_ref_id,
            body.task_ref_type.as_deref(),
        )
        .await
        .map(|t| (StatusCode::CREATED, Json(ScheduleTemplateResponse::from(t))))
        .map_err(|e| {
            tracing::error!(error = %e, "create_template DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    delete,
    path = "/schedule/templates/{id}",
    tag = "Schedule Templates",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Template ID")),
    responses(
        (status = 204, description = "Template deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Template not found or not owned by current user"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn delete_template(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(template_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    state
        .repos
        .schedule_template
        .delete_template(user_id, template_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "delete_template DB error");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_task_types_matches_db_check_constraint() {
        for t in &["meal", "exercise", "work", "leisure", "appointment", "medication", "custom"] {
            assert!(VALID_TASK_TYPES.contains(t), "missing task_type: {t}");
        }
        assert!(!VALID_TASK_TYPES.contains(&"invalid"));
    }

    #[test]
    fn valid_recurrences_matches_db_check_constraint() {
        for r in &["daily", "weekdays", "weekly", "custom"] {
            assert!(VALID_RECURRENCES.contains(r), "missing recurrence: {r}");
        }
        assert!(!VALID_RECURRENCES.contains(&"biweekly"));
    }

    #[test]
    fn valid_energies_matches_db_check_constraint() {
        for e in &["low", "medium", "high"] {
            assert!(VALID_ENERGIES.contains(e), "missing energy: {e}");
        }
        assert!(!VALID_ENERGIES.contains(&"extreme"));
    }
}
