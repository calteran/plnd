use chrono::{NaiveDate, TimeZone, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::Task;

/// Idempotently create the "Plan your week" generic task for a horizon.
/// Inserts into `tasks` + `generic_tasks` in a transaction.
/// Returns existing task if one already exists for the given plan_start.
pub async fn create_weekly_plan_task(
    pool: &PgPool,
    user_id: Uuid,
    plan_start: NaiveDate,
    trigger_offset: i16,
) -> Result<Task, DatabaseError> {
    let trigger_date = plan_start + chrono::Duration::days(trigger_offset as i64);
    // Midnight UTC on the trigger date
    let scheduled_start = Utc
        .from_utc_datetime(&trigger_date.and_hms_opt(0, 0, 0).unwrap());

    // Idempotency: check for existing weekly_plan task at this horizon
    let existing: Option<Task> = sqlx::query_as::<_, Task>(
        "SELECT t.task_id, t.user_id, t.title, t.task_type, t.scheduled_start,
                t.duration_minutes, t.energy_required, t.status, t.is_milepost,
                t.created_at, t.updated_at
         FROM tasks t
         JOIN generic_tasks gt USING (task_id)
         WHERE t.user_id = $1
           AND gt.category = 'weekly_plan'
           AND t.scheduled_start >= $2
           AND t.scheduled_start < $3
         LIMIT 1",
    )
    .bind(user_id)
    .bind(Utc.from_utc_datetime(&plan_start.and_hms_opt(0, 0, 0).unwrap()))
    .bind(Utc.from_utc_datetime(
        &(plan_start + chrono::Duration::days(90)).and_hms_opt(0, 0, 0).unwrap(),
    ))
    .fetch_optional(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    if let Some(task) = existing {
        return Ok(task);
    }

    // Create in a transaction: tasks + generic_tasks
    let mut tx = pool.begin().await.map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    let task: Task = sqlx::query_as::<_, Task>(
        "INSERT INTO tasks (user_id, title, task_type, scheduled_start, energy_required, status)
         VALUES ($1, 'Plan your week', 'custom', $2, 'low', 'planned')
         RETURNING task_id, user_id, title, task_type, scheduled_start, duration_minutes,
                   energy_required, status, is_milepost, created_at, updated_at",
    )
    .bind(user_id)
    .bind(scheduled_start)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    sqlx::query(
        "INSERT INTO generic_tasks (task_id, category, priority)
         VALUES ($1, 'weekly_plan', 'normal')",
    )
    .bind(task.task_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    tx.commit().await.map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    Ok(task)
}
