use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::Task;

/// Idempotently create the "Plan your week" generic task for a horizon.
/// Inserts into `tasks` + `generic_tasks` in a transaction.
/// Returns existing task if one already exists for the given plan_start.
#[tracing::instrument(skip(pool), fields(table = "tasks", op = "create_weekly_plan_task"))]
pub async fn create_weekly_plan_task(
    pool: &PgPool,
    user_id: Uuid,
    plan_start: NaiveDate,
    trigger_offset: i16,
) -> Result<Task, DatabaseError> {
    let trigger_date = plan_start
        + chrono::TimeDelta::try_days(trigger_offset as i64)
            .ok_or_else(|| DatabaseError::QueryError("invalid trigger_offset".into()))?;
    // Midnight UTC on the trigger date
    let scheduled_start = trigger_date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| DatabaseError::QueryError("invalid trigger time".into()))?
        .and_utc();

    // Idempotency: check for existing weekly_plan task at this horizon.
    // Lower bound uses trigger_date (not plan_start) to handle negative offsets correctly —
    // when trigger_offset < 0 the task is scheduled before plan_start.
    let existing: Option<Task> = sqlx::query_as::<_, Task>(
        "SELECT t.task_id, t.user_id, t.title, t.task_type, t.scheduled_start,
                t.duration_minutes, t.energy_required, t.status, t.is_milepost,
                t.created_at, t.updated_at
         FROM tasks t
         JOIN generic_tasks gt USING (task_id)
         WHERE t.user_id = $1
           AND gt.category = 'weekly_plan'
           AND t.scheduled_start = $2
         LIMIT 1",
    )
    .bind(user_id)
    .bind(scheduled_start)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)?;

    if let Some(task) = existing {
        return Ok(task);
    }

    // Create in a transaction: tasks + generic_tasks
    let mut tx = pool.begin().await.map_err(DatabaseError::from)?;

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
    .map_err(DatabaseError::from)?;

    sqlx::query(
        "INSERT INTO generic_tasks (task_id, category, priority)
         VALUES ($1, 'weekly_plan', 'normal')",
    )
    .bind(task.task_id)
    .execute(&mut *tx)
    .await
    .map_err(DatabaseError::from)?;

    tx.commit().await.map_err(DatabaseError::from)?;

    Ok(task)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::users;
    use chrono::NaiveDate;

    /// Helper: create a throwaway user and return its UUID.
    async fn new_user(pool: &PgPool) -> Uuid {
        users::create(
            pool,
            &format!("{}@test.invalid", Uuid::new_v4()),
            None,
            None,
        )
        .await
        .expect("failed to create test user")
        .user_id
    }

    fn plan_start() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 5, 5).unwrap()
    }

    // -----------------------------------------------------------------------
    // create_weekly_plan_task
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn create_weekly_plan_task_inserts_both_tables(pool: PgPool) {
        let uid = new_user(&pool).await;

        let task = create_weekly_plan_task(&pool, uid, plan_start(), 0)
            .await
            .expect("create_weekly_plan_task failed");

        // Verify Task fields
        assert_eq!(task.user_id, uid);
        assert_eq!(task.title, "Plan your week");
        assert_eq!(task.task_type, "custom");
        assert_eq!(task.energy_required, "low");
        assert_eq!(task.status, "planned");

        // Verify the generic_tasks row was inserted
        let category: String =
            sqlx::query_scalar("SELECT category FROM generic_tasks WHERE task_id = $1")
                .bind(task.task_id)
                .fetch_one(&pool)
                .await
                .expect("generic_tasks row not found");

        assert_eq!(category, "weekly_plan");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_weekly_plan_task_is_idempotent(pool: PgPool) {
        let uid = new_user(&pool).await;

        let first = create_weekly_plan_task(&pool, uid, plan_start(), 0)
            .await
            .unwrap();
        let second = create_weekly_plan_task(&pool, uid, plan_start(), 0)
            .await
            .unwrap();

        assert_eq!(
            first.task_id, second.task_id,
            "second call must return the same task"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_weekly_plan_task_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;

        let task_a = create_weekly_plan_task(&pool, uid_a, plan_start(), 0)
            .await
            .unwrap();
        let task_b = create_weekly_plan_task(&pool, uid_b, plan_start(), 0)
            .await
            .unwrap();

        assert_ne!(
            task_a.task_id, task_b.task_id,
            "users must get separate tasks"
        );
        assert_eq!(task_a.user_id, uid_a);
        assert_eq!(task_b.user_id, uid_b);
    }
}
