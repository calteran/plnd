use crate::api_response::{
    PlanStatusApiResponse, PostSchedulePlanApiResponse, SchedulePeriodApiResponse,
};
use crate::auth::jwt::Claims;
use crate::models::{
    CarryoverDecision as HttpCarryoverDecision, PatchEntryStatusRequest, PlanEntryRequest,
    PostSchedulePlanRequest,
};
use crate::routes::domain_constants::{
    VALID_AFTER_MILEPOSTS, VALID_ENERGY_LEVELS, VALID_TASK_TYPES,
};
use crate::scheduling::{date_matches_recurrence, is_recognised_recurrence};
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
};
use chrono::NaiveDate;
use plnd_data::Error;
use plnd_data::models::{CarryoverDecision, CommitPlanInput, MealHabit, PlanEntryInput};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct PeriodQuery {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

// ---------------------------------------------------------------------------
// Entry mapping helper — shared by `entries` and `placed_tasks` fields
// ---------------------------------------------------------------------------

fn map_entry(e: PlanEntryRequest) -> Result<PlanEntryInput, StatusCode> {
    if !VALID_TASK_TYPES.contains(&e.task_type.as_str()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some(ref mp) = e.after_milepost
        && !VALID_AFTER_MILEPOSTS.contains(&mp.as_str())
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
        after_milepost: e.after_milepost,
        duration_minutes: e
            .duration_minutes
            .map(|d| i32::try_from(d).map_err(|_| StatusCode::BAD_REQUEST))
            .transpose()?,
        energy_required: e.energy_required,
    })
}

// ---------------------------------------------------------------------------
// Meal habit expansion helpers
// ---------------------------------------------------------------------------

/// Expands a single meal habit into one `PlanEntryInput` per matching date in [plan_start, plan_end].
/// Caller must guarantee that `plan_end - plan_start <= 366 days` (enforced in `post_plan`).
fn expand_habit_to_entries(
    habit: &MealHabit,
    plan_start: NaiveDate,
    plan_end: NaiveDate,
) -> Vec<PlanEntryInput> {
    if !is_recognised_recurrence(&habit.recurrence_rule) {
        tracing::warn!(
            rule = %habit.recurrence_rule,
            "unrecognised meal habit recurrence_rule — skipping expansion"
        );
        return Vec::new();
    }

    let mut entries = Vec::new();
    let mut date = plan_start;
    while date <= plan_end {
        if date_matches_recurrence(date, &habit.recurrence_rule) {
            entries.push(PlanEntryInput {
                date,
                task_type: "meal".to_string(),
                title: Some(habit.meal_name.clone()),
                after_milepost: Some(habit.slot.clone()),
                scheduled_start: None,
                task_ref_id: None,
                task_ref_type: None,
                duration_minutes: None,
                energy_required: None,
            });
        }
        // Safe: post_plan validates plan_end - plan_start <= 366, so we never reach NaiveDate::MAX.
        if let Some(next) = date.succ_opt() {
            date = next;
        } else {
            break;
        }
    }
    entries
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

    // Expand meal habits into recurring meal entries across the plan period
    if !body.meal_habit_ids.is_empty() {
        let habit_id_set: HashSet<Uuid> = body.meal_habit_ids.into_iter().collect();
        let all_habits = state
            .repos
            .meal_habit
            .list_for_user(user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "meal_habit list_for_user error");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        for habit in all_habits
            .into_iter()
            .filter(|h| habit_id_set.contains(&h.id))
        {
            entries.extend(expand_habit_to_entries(
                &habit,
                body.plan_start,
                body.plan_end,
            ));
        }
    }

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
// Unit tests for recurrence expansion helpers (no DB needed)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    // -----------------------------------------------------------------------
    // expand_habit_to_entries
    // -----------------------------------------------------------------------

    fn make_habit(meal_name: &str, slot: &str, recurrence_rule: &str) -> MealHabit {
        MealHabit {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            meal_name: meal_name.to_string(),
            slot: slot.to_string(),
            recurrence_rule: recurrence_rule.to_string(),
            created_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn expand_daily_fills_entire_range() {
        let habit = make_habit("Oatmeal", "breakfast", "daily");
        let start = date(2026, 4, 27);
        let end = date(2026, 4, 29); // 3 days
        let entries = expand_habit_to_entries(&habit, start, end);
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().all(|e| e.task_type == "meal"));
        assert!(
            entries
                .iter()
                .all(|e| e.title == Some("Oatmeal".to_string()))
        );
        assert!(
            entries
                .iter()
                .all(|e| e.after_milepost == Some("breakfast".to_string()))
        );
        assert!(entries.iter().all(|e| e.scheduled_start.is_none()));
    }

    #[test]
    fn expand_weekdays_skips_weekend() {
        // Mon 27 Apr – Sun 3 May 2026 = 7 days, 5 weekdays
        let habit = make_habit("Salad", "lunch", "weekdays");
        let start = date(2026, 4, 27); // Monday
        let end = date(2026, 5, 3); // Sunday
        let entries = expand_habit_to_entries(&habit, start, end);
        assert_eq!(entries.len(), 5);
    }

    #[test]
    fn expand_weekends_skips_weekdays() {
        // Mon 27 Apr – Sun 3 May 2026 = 7 days, 2 weekend days
        let habit = make_habit("Pancakes", "breakfast", "weekends");
        let start = date(2026, 4, 27); // Monday
        let end = date(2026, 5, 3); // Sunday
        let entries = expand_habit_to_entries(&habit, start, end);
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn expand_weekly_byday_mo_gives_only_mondays() {
        // 2 weeks starting Mon 27 Apr 2026
        let habit = make_habit("Pasta", "dinner", "FREQ=WEEKLY;BYDAY=MO");
        let start = date(2026, 4, 27); // Monday
        let end = date(2026, 5, 10); // Sunday of week 2 (14 days)
        let entries = expand_habit_to_entries(&habit, start, end);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].date, date(2026, 4, 27));
        assert_eq!(entries[1].date, date(2026, 5, 4));
    }

    #[test]
    fn expand_unknown_recurrence_returns_empty() {
        let habit = make_habit("Mystery meal", "dinner", "quarterly");
        let start = date(2026, 4, 27);
        let end = date(2026, 5, 10);
        let entries = expand_habit_to_entries(&habit, start, end);
        assert_eq!(entries.len(), 0);
    }

    #[test]
    fn expand_single_day_range() {
        let habit = make_habit("Toast", "breakfast", "daily");
        let start = date(2026, 4, 27);
        let entries = expand_habit_to_entries(&habit, start, start);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].date, start);
    }

    // -----------------------------------------------------------------------
    // map_entry validation
    // -----------------------------------------------------------------------

    fn base_entry() -> PlanEntryRequest {
        PlanEntryRequest {
            date: date(2026, 4, 27),
            task_type: "work".to_string(),
            task_ref_id: None,
            task_ref_type: None,
            title: Some("Test".to_string()),
            scheduled_start: None,
            after_milepost: None,
            duration_minutes: None,
            energy_required: None,
        }
    }

    #[test]
    fn map_entry_rejects_invalid_task_type() {
        let e = PlanEntryRequest {
            task_type: "invalid_type".to_string(),
            ..base_entry()
        };
        assert_eq!(map_entry(e).unwrap_err(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn map_entry_rejects_invalid_after_milepost() {
        let e = PlanEntryRequest {
            after_milepost: Some("brunch".to_string()),
            ..base_entry()
        };
        assert_eq!(map_entry(e).unwrap_err(), StatusCode::BAD_REQUEST);
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
            task_type: "meal".to_string(),
            after_milepost: Some("lunch".to_string()),
            energy_required: Some("low".to_string()),
            ..base_entry()
        };
        assert!(map_entry(e).is_ok());
    }
}
