use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::{PlanStatusResponse, ScheduleEntry, SchedulePeriodResponse};

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

    let carryover: Vec<ScheduleEntry> = sqlx::query_as::<_, ScheduleEntry>(&format!(
        "SELECT {ENTRY_COLS} FROM schedule_entries
         WHERE user_id = $1 AND date < $2
           AND status IN ('planned', 'deferred')
         ORDER BY date, scheduled_start"
    ))
    .bind(user_id)
    .bind(start)
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
