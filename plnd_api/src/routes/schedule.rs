use crate::api_response::{
    CarryoverApiResponse, PlanStatusApiResponse, PostSchedulePlanApiResponse,
    SchedulePeriodApiResponse,
};
use crate::auth::jwt::Claims;
use crate::models::{
    CarryoverDecision as HttpCarryoverDecision, MealEntryRequest, PatchEntryRequest,
    PatchEntryStatusRequest, PlanEntryRequest, PostSchedulePlanRequest, RepositionEntryRequest,
};
use crate::routes::domain_constants::{
    VALID_ENERGY_LEVELS, VALID_MEAL_REF_TYPES, VALID_TASK_TYPES,
};
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
};
use chrono::NaiveDate;
use plnd_data::Error;
use plnd_data::models::{
    CarryoverDecision, CommitPlanInput, EntryPatch, PlanEntryInput, PlannedMealEntryStaging,
};
use plnd_data::repository::schedule::SlotTarget;
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
        title: e.title,
        scheduled_start: e.scheduled_start,
        after_anchor: e.after_anchor,
        duration_minutes: e
            .duration_minutes
            .map(|d| i32::try_from(d).map_err(|_| StatusCode::BAD_REQUEST))
            .transpose()?,
        energy_required: e.energy_required,
        one_shot: e.one_shot,
        slot_position: e.slot_position,
        paired_meal_name: e.paired_meal_name,
    })
}

// ---------------------------------------------------------------------------
// Meal-entry mapping helper — used to stage `meal_entries` for commit_plan.
// ---------------------------------------------------------------------------

fn map_meal_entry(e: MealEntryRequest) -> Result<PlannedMealEntryStaging, StatusCode> {
    if !VALID_MEAL_REF_TYPES.contains(&e.meal_ref_type.as_str()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(PlannedMealEntryStaging {
        date: e.date,
        meal_name: e.meal_name,
        meal_ref_id: e.meal_ref_id,
        meal_ref_type: e.meal_ref_type,
        title: e.title,
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
        (status = 503, description = "Database unavailable"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn get_period(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<PeriodQuery>,
) -> Result<Json<SchedulePeriodApiResponse>, StatusCode> {
    if params.end < params.start {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let map_err = |e: Error, op: &'static str| match e {
        Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
        e => {
            tracing::error!(error = %e, op, "get_period error");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    };

    let period = state
        .repos
        .schedule
        .get_period(user_id, params.start, params.end)
        .await
        .map_err(|e| map_err(e, "get_period"))?;

    let planned_meals = state
        .repos
        .meal_plan
        .list_for_period(user_id, params.start, params.end)
        .await
        .map_err(|e| map_err(e, "meal_plan::list_for_period"))?;

    Ok(Json(SchedulePeriodApiResponse::from_parts(
        period,
        planned_meals,
    )))
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
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
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
        (status = 503, description = "Database unavailable"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
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
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "get_plan_status error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
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
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
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

    // Map approved meal entries (paired to schedule_entries inside commit_plan).
    let meal_entries = body
        .meal_entries
        .into_iter()
        .map(map_meal_entry)
        .collect::<Result<Vec<_>, _>>()?;

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
        meal_entries,
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

/// Validate a partial entry update. Returns `Err` with a 400 for any provided-but-invalid field.
fn validate_patch(req: &PatchEntryRequest) -> Result<(), StatusCode> {
    if let Some(t) = &req.task_type
        && !VALID_TASK_TYPES.contains(&t.as_str())
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some(e) = &req.energy_required
        && !VALID_ENERGY_LEVELS.contains(&e.as_str())
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some(d) = req.duration_minutes
        && d <= 0
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some(t) = &req.title
        && t.trim().is_empty()
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}

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
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
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

#[utoipa::path(
    patch,
    path = "/schedule/entries/{id}",
    tag = "Schedule",
    params(("id" = Uuid, Path, description = "Schedule entry ID")),
    request_body = PatchEntryRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Entry updated"),
        (status = 400, description = "Invalid field value"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Entry not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn patch_entry(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(entry_id): Path<Uuid>,
    Json(body): Json<PatchEntryRequest>,
) -> Result<StatusCode, StatusCode> {
    validate_patch(&body)?;
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let patch = EntryPatch {
        title: body.title.map(|t| t.trim().to_string()),
        task_type: body.task_type,
        scheduled_start: body.scheduled_start,
        duration_minutes: body.duration_minutes,
        energy_required: body.energy_required,
        one_shot: body.one_shot,
    };

    state
        .repos
        .schedule
        .update_entry(user_id, entry_id, &patch)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| match e {
            Error::NotFound => StatusCode::NOT_FOUND,
            _ => {
                tracing::error!(error = %e, "patch_entry error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

/// Resolve the request's polymorphic slot key into a `SlotTarget`. Exactly one
/// of `after_anchor` / `slot_meal_anchor_id` must be set.
fn reposition_target(req: &RepositionEntryRequest) -> Result<SlotTarget, StatusCode> {
    match (&req.after_anchor, req.slot_meal_anchor_id) {
        (Some(a), None) if !a.trim().is_empty() => Ok(SlotTarget::AfterAnchor(a.clone())),
        (None, Some(m)) => Ok(SlotTarget::MealAnchor(m)),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

#[utoipa::path(
    patch,
    path = "/schedule/entries/{id}/position",
    tag = "Schedule",
    params(("id" = Uuid, Path, description = "Schedule entry ID")),
    request_body = RepositionEntryRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Entry repositioned"),
        (status = 400, description = "Zero or both slot keys"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Entry not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn reposition_entry(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(entry_id): Path<Uuid>,
    Json(body): Json<RepositionEntryRequest>,
) -> Result<StatusCode, StatusCode> {
    let target = reposition_target(&body)?;
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .schedule
        .reposition_entry(user_id, entry_id, body.date, &target, body.position)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| match e {
            Error::NotFound => StatusCode::NOT_FOUND,
            _ => {
                tracing::error!(error = %e, "reposition_entry error");
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
            title: Some("Test".to_string()),
            scheduled_start: None,
            after_anchor: None,
            duration_minutes: None,
            energy_required: None,
            one_shot: None,
            slot_position: None,
            paired_meal_name: None,
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

    #[test]
    fn map_entry_passes_one_shot_true_through() {
        let e = PlanEntryRequest {
            one_shot: Some(true),
            ..base_entry()
        };
        let result = map_entry(e).unwrap();
        assert_eq!(result.one_shot, Some(true));
    }

    #[test]
    fn map_entry_one_shot_defaults_to_none_when_absent() {
        let e = base_entry();
        let result = map_entry(e).unwrap();
        assert_eq!(result.one_shot, None);
    }

    fn base_meal_entry() -> MealEntryRequest {
        MealEntryRequest {
            date: date(2026, 4, 27),
            meal_name: "breakfast".to_string(),
            meal_ref_id: Uuid::new_v4(),
            meal_ref_type: "user_meal".to_string(),
            title: Some("Oatmeal".to_string()),
        }
    }

    #[test]
    fn map_meal_entry_accepts_valid_ref_types() {
        for ref_type in &["user_meal", "catalog_meal", "user_dish", "catalog_dish"] {
            let e = MealEntryRequest {
                meal_ref_type: (*ref_type).to_string(),
                ..base_meal_entry()
            };
            assert!(
                map_meal_entry(e).is_ok(),
                "meal_ref_type '{ref_type}' must be accepted"
            );
        }
    }

    #[test]
    fn map_meal_entry_rejects_invalid_ref_type() {
        let e = MealEntryRequest {
            meal_ref_type: "bogus".to_string(),
            ..base_meal_entry()
        };
        assert_eq!(map_meal_entry(e).unwrap_err(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn validate_patch_accepts_valid_fields() {
        let req = PatchEntryRequest {
            title: Some("Call dentist".into()),
            task_type: Some("appointment".into()),
            scheduled_start: None,
            duration_minutes: Some(30),
            energy_required: Some("low".into()),
            one_shot: Some(true),
        };
        assert!(validate_patch(&req).is_ok());
    }

    #[test]
    fn validate_patch_rejects_bad_type_energy_duration_and_blank_title() {
        let bad_type = PatchEntryRequest {
            task_type: Some("nope".into()),
            ..empty_patch()
        };
        assert!(validate_patch(&bad_type).is_err());

        let bad_energy = PatchEntryRequest {
            energy_required: Some("ultra".into()),
            ..empty_patch()
        };
        assert!(validate_patch(&bad_energy).is_err());

        let bad_dur = PatchEntryRequest {
            duration_minutes: Some(0),
            ..empty_patch()
        };
        assert!(validate_patch(&bad_dur).is_err());

        let blank = PatchEntryRequest {
            title: Some("   ".into()),
            ..empty_patch()
        };
        assert!(validate_patch(&blank).is_err());
    }

    fn empty_patch() -> PatchEntryRequest {
        PatchEntryRequest {
            title: None,
            task_type: None,
            scheduled_start: None,
            duration_minutes: None,
            energy_required: None,
            one_shot: None,
        }
    }

    #[test]
    fn reposition_target_requires_exactly_one_slot_key() {
        use crate::models::RepositionEntryRequest;
        let neither = RepositionEntryRequest {
            date: date(2026, 1, 1),
            after_anchor: None,
            slot_meal_anchor_id: None,
            position: 0,
        };
        assert!(super::reposition_target(&neither).is_err());

        let both = RepositionEntryRequest {
            date: date(2026, 1, 1),
            after_anchor: Some("lunch".into()),
            slot_meal_anchor_id: Some(Uuid::new_v4()),
            position: 0,
        };
        assert!(super::reposition_target(&both).is_err());

        let ok_anchor = RepositionEntryRequest {
            date: date(2026, 1, 1),
            after_anchor: Some("lunch".into()),
            slot_meal_anchor_id: None,
            position: 1,
        };
        assert!(super::reposition_target(&ok_anchor).is_ok());
    }
}
