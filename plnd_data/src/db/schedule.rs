use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::{CarryoverDecision, CommitPlanInput, ScheduleEntry};
use crate::db::query_types::{
    PlanStatusResponse, PostSchedulePlanResponse, SchedulePeriodResponse,
};

/// Maximum number of days before the period start to search for carryover entries.
/// Older planned/deferred entries are excluded to prevent unbounded historical scans.
pub const CARRYOVER_LOOKBACK_DAYS: i64 = 90;

const ENTRY_COLS: &str =
    "entry_id, user_id, template_id, task_type, task_ref_id, task_ref_type, title,
     date, scheduled_start, scheduled_end, status, actual_start, actual_end,
     family_meal_id, after_milepost, after_entry_id, deviation_note, created_at, updated_at";

pub async fn get_period(
    pool: &PgPool,
    user_id: Uuid,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<SchedulePeriodResponse, DatabaseError> {
    let entries: Vec<ScheduleEntry> = sqlx::query_as::<_, ScheduleEntry>(&format!(
        "SELECT {ENTRY_COLS} FROM schedule_entries
         WHERE user_id = $1 AND date >= $2 AND date <= $3
         ORDER BY date, scheduled_start"
    ))
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    let carryover_start = start - chrono::Duration::days(CARRYOVER_LOOKBACK_DAYS);
    let carryover: Vec<ScheduleEntry> = sqlx::query_as::<_, ScheduleEntry>(&format!(
        "SELECT {ENTRY_COLS} FROM schedule_entries
         WHERE user_id = $1 AND date < $2 AND date >= $3
           AND status IN ('planned', 'deferred')
         ORDER BY date, scheduled_start"
    ))
    .bind(user_id)
    .bind(start)
    .bind(carryover_start)
    .fetch_all(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    Ok(SchedulePeriodResponse { entries, carryover })
}

pub async fn get_plan_status(
    pool: &PgPool,
    user_id: Uuid,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<PlanStatusResponse, DatabaseError> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM schedule_entries
         WHERE user_id = $1 AND date >= $2 AND date <= $3
           AND status IN ('planned', 'in_progress', 'completed')",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    Ok(PlanStatusResponse {
        planned: row.0 > 0,
        entry_count: row.0,
    })
}

pub async fn commit_plan(
    pool: &PgPool,
    user_id: Uuid,
    req: &CommitPlanInput,
) -> Result<PostSchedulePlanResponse, DatabaseError> {
    let today = chrono::Utc::now().date_naive();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    // If replace=true, delete planned entries for unstarted days only (spec §303).
    // An unstarted day has no in_progress or completed entries; started days are
    // left completely untouched even if replace=true.
    if req.replace {
        let started_days: Vec<NaiveDate> = sqlx::query_scalar(
            "SELECT DISTINCT date FROM schedule_entries
             WHERE user_id = $1 AND date >= $2 AND date <= $3
               AND status IN ('in_progress', 'completed')",
        )
        .bind(user_id)
        .bind(req.plan_start)
        .bind(req.plan_end)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

        sqlx::query(
            "DELETE FROM schedule_entries
             WHERE user_id = $1
               AND date >= GREATEST($2, $3)
               AND date <= $4
               AND status = 'planned'
               AND date != ALL($5)",
        )
        .bind(user_id)
        .bind(today)
        .bind(req.plan_start)
        .bind(req.plan_end)
        .bind(&started_days)
        .execute(&mut *tx)
        .await
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
    }

    // Collect and batch-insert all new entries in a single unnest query
    let mut task_types: Vec<String> = Vec::new();
    let mut task_ref_ids: Vec<Option<Uuid>> = Vec::new();
    let mut task_ref_types: Vec<Option<String>> = Vec::new();
    let mut titles: Vec<Option<String>> = Vec::new();
    let mut dates: Vec<NaiveDate> = Vec::new();
    let mut scheduled_starts: Vec<DateTime<Utc>> = Vec::new();
    let mut after_mileposts: Vec<Option<String>> = Vec::new();

    for entry in &req.entries {
        let scheduled_start = entry.date.and_time(entry.scheduled_start).and_utc();
        task_types.push(entry.task_type.clone());
        task_ref_ids.push(entry.task_ref_id);
        task_ref_types.push(entry.task_ref_type.clone());
        titles.push(entry.title.clone());
        dates.push(entry.date);
        scheduled_starts.push(scheduled_start);
        after_mileposts.push(entry.after_milepost.clone());
    }

    let committed = task_types.len() as i64;

    if !task_types.is_empty() {
        sqlx::query(
            "INSERT INTO schedule_entries
               (user_id, task_type, task_ref_id, task_ref_type, title,
                date, scheduled_start, status, after_milepost)
             SELECT $1, unnest($2::text[]), unnest($3::uuid[]), unnest($4::text[]),
                    unnest($5::text[]), unnest($6::date[]), unnest($7::timestamptz[]),
                    'planned', unnest($8::text[])",
        )
        .bind(user_id)
        .bind(&task_types)
        .bind(&task_ref_ids)
        .bind(&task_ref_types)
        .bind(&titles)
        .bind(&dates)
        .bind(&scheduled_starts)
        .bind(&after_mileposts)
        .execute(&mut *tx)
        .await
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
    }

    // Mark planning task as completed
    sqlx::query(
        "UPDATE tasks SET status = 'completed', updated_at = NOW()
         WHERE task_id = $1 AND user_id = $2",
    )
    .bind(req.planning_task_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    // Apply carryover decisions: update carry-over entries
    for (entry_id, decision) in &req.carryover_decisions {
        match decision {
            CarryoverDecision::Accept => {
                // Reschedule to the new horizon start, keeping status 'planned'.
                // Update both `date` and `scheduled_start` so the absolute TIMESTAMPTZ
                // moves to the new date while preserving the wall-clock time (UTC).
                sqlx::query(
                    "UPDATE schedule_entries
                     SET date = $1,
                         scheduled_start = ($1 + (scheduled_start AT TIME ZONE 'UTC')::time) AT TIME ZONE 'UTC',
                         updated_at = NOW()
                     WHERE entry_id = $2 AND user_id = $3",
                )
                .bind(req.plan_start)
                .bind(entry_id)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
            }
            CarryoverDecision::Defer => {
                sqlx::query(
                    "UPDATE schedule_entries SET status = 'deferred', updated_at = NOW()
                     WHERE entry_id = $1 AND user_id = $2",
                )
                .bind(entry_id)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
            }
            CarryoverDecision::Dismiss => {
                sqlx::query(
                    "UPDATE schedule_entries SET status = 'skipped', updated_at = NOW()
                     WHERE entry_id = $1 AND user_id = $2",
                )
                .bind(entry_id)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
            }
        }
    }

    tx.commit()
        .await
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    Ok(PostSchedulePlanResponse {
        committed,
        planning_task_status: "completed".to_string(),
    })
}
