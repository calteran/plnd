use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
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

/// Create a user-defined task with a given title, energy level, scheduled time, and duration.
/// Inserts into `tasks` (type=`'custom'`) and `generic_tasks` (category=`'user_created'`)
/// in a single transaction.
#[tracing::instrument(skip(pool), fields(table = "tasks", op = "create_user_task"))]
pub async fn create_user_task(
    pool: &PgPool,
    user_id: Uuid,
    title: &str,
    energy_level: &str,
    scheduled_at: DateTime<Utc>,
    duration_minutes: i32,
) -> Result<Task, DatabaseError> {
    let mut tx = pool.begin().await.map_err(DatabaseError::from)?;

    let task: Task = sqlx::query_as::<_, Task>(
        "INSERT INTO tasks (user_id, title, task_type, scheduled_start, duration_minutes, energy_required, status)
         VALUES ($1, $2, 'custom', $3, $4, $5, 'planned')
         RETURNING task_id, user_id, title, task_type, scheduled_start, duration_minutes,
                   energy_required, status, is_milepost, created_at, updated_at",
    )
    .bind(user_id)
    .bind(title)
    .bind(scheduled_at)
    .bind(duration_minutes)
    .bind(energy_level)
    .fetch_one(&mut *tx)
    .await
    .map_err(DatabaseError::from)?;

    sqlx::query(
        "INSERT INTO generic_tasks (task_id, category, priority)
         VALUES ($1, 'user_created', 'normal')",
    )
    .bind(task.task_id)
    .execute(&mut *tx)
    .await
    .map_err(DatabaseError::from)?;

    tx.commit().await.map_err(DatabaseError::from)?;

    Ok(task)
}

/// Find the next free time slot for a user based on energy level and duration.
///
/// Applies time-of-day heuristics: `high` → 9 am UTC, `medium` → 10 am UTC, `low` → 1 pm UTC.
/// Scans `schedule_entries` for conflicts, checking up to 14 days forward from `after`.
/// Returns `(slot_start, slot_end)` for the first conflict-free slot found.
///
/// Only the preferred hour is tried per day — if that slot has a conflict, the entire
/// day is skipped and the heuristic hour on the next day is tried.
#[tracing::instrument(skip(pool), fields(table = "schedule_entries", op = "find_free_slot"))]
pub async fn find_free_slot(
    pool: &PgPool,
    user_id: Uuid,
    energy_level: &str,
    duration_minutes: i32,
    after: DateTime<Utc>,
) -> Result<(DateTime<Utc>, DateTime<Utc>), DatabaseError> {
    let preferred_hour: u32 = match energy_level {
        "high" => 9,
        "medium" => 10,
        "low" => 13,
        other => {
            return Err(DatabaseError::QueryError(format!(
                "invalid energy_level: {other}"
            )))
        }
    };

    let duration = Duration::minutes(duration_minutes as i64);
    let start_date = after.date_naive();

    for day_offset in 0..14i64 {
        let candidate_date = start_date
            + chrono::TimeDelta::try_days(day_offset)
                .ok_or_else(|| DatabaseError::QueryError("day offset overflow".into()))?;

        let naive_time = NaiveTime::from_hms_opt(preferred_hour, 0, 0)
            .ok_or_else(|| DatabaseError::QueryError("invalid heuristic hour".into()))?;
        let naive_dt = candidate_date.and_time(naive_time);
        let candidate_start = Utc.from_utc_datetime(&naive_dt);

        // If the preferred hour has already passed (e.g. `after` is 11am for a 10am slot),
        // skip this day entirely — only the heuristic hour is tried per day.
        if candidate_start < after {
            continue;
        }

        let candidate_end = candidate_start + duration;

        // Use timestamp-range overlap (not date filter) so overnight entries from the
        // previous day are correctly detected as conflicts.
        // Uses the (user_id, scheduled_start) index for performance.
        let conflict_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM schedule_entries
             WHERE user_id = $1
               AND scheduled_start < $2
               AND (scheduled_end IS NULL OR scheduled_end > $3)",
        )
        .bind(user_id)
        .bind(candidate_end)
        .bind(candidate_start)
        .fetch_one(pool)
        .await
        .map_err(DatabaseError::from)?;

        if conflict_count == 0 {
            return Ok((candidate_start, candidate_end));
        }
    }

    Err(DatabaseError::QueryError(
        "no free slot found in 14 days".into(),
    ))
}

// ── TaskStore ─────────────────────────────────────────────────────────────────

/// Owned handle for task scheduling operations.
///
/// Wraps [`PgPool`] so callers (e.g. `plnd_agent` tools) do not need a direct
/// sqlx dependency — sqlx is a private implementation detail of `plnd_data`.
#[derive(Clone)]
pub struct TaskStore {
    pool: PgPool,
}

impl TaskStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create_user_task(
        &self,
        user_id: Uuid,
        title: &str,
        energy_level: &str,
        scheduled_at: DateTime<Utc>,
        duration_minutes: i32,
    ) -> Result<Task, DatabaseError> {
        create_user_task(
            &self.pool,
            user_id,
            title,
            energy_level,
            scheduled_at,
            duration_minutes,
        )
        .await
    }

    pub async fn find_free_slot(
        &self,
        user_id: Uuid,
        energy_level: &str,
        duration_minutes: i32,
        after: DateTime<Utc>,
    ) -> Result<(DateTime<Utc>, DateTime<Utc>), DatabaseError> {
        find_free_slot(&self.pool, user_id, energy_level, duration_minutes, after).await
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::users;
    use chrono::{NaiveDate, Timelike};

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

    // -----------------------------------------------------------------------
    // create_user_task
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn create_user_task_inserts_task_and_generic(pool: PgPool) {
        let uid = new_user(&pool).await;
        let scheduled_at = Utc.with_ymd_and_hms(2026, 5, 10, 9, 0, 0).unwrap();

        let task = create_user_task(&pool, uid, "Buy groceries", "medium", scheduled_at, 30)
            .await
            .expect("create_user_task failed");

        assert_eq!(task.user_id, uid);
        assert_eq!(task.title, "Buy groceries");
        assert_eq!(task.task_type, "custom");
        assert_eq!(task.energy_required, "medium");
        assert_eq!(task.status, "planned");
        assert_eq!(task.duration_minutes, Some(30));

        let category: String =
            sqlx::query_scalar("SELECT category FROM generic_tasks WHERE task_id = $1")
                .bind(task.task_id)
                .fetch_one(&pool)
                .await
                .expect("generic_tasks row not found");

        assert_eq!(category, "user_created");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_user_task_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let scheduled_at = Utc.with_ymd_and_hms(2026, 5, 10, 9, 0, 0).unwrap();

        let task_a = create_user_task(&pool, uid_a, "Task A", "high", scheduled_at, 60)
            .await
            .unwrap();
        let task_b = create_user_task(&pool, uid_b, "Task B", "high", scheduled_at, 60)
            .await
            .unwrap();

        assert_ne!(
            task_a.task_id, task_b.task_id,
            "users must get separate tasks"
        );
        assert_eq!(task_a.user_id, uid_a);
        assert_eq!(task_b.user_id, uid_b);
    }

    // -----------------------------------------------------------------------
    // find_free_slot
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn find_free_slot_returns_slot_when_clear(pool: PgPool) {
        let uid = new_user(&pool).await;
        // No schedule_entries — first candidate slot must be returned immediately
        let after = Utc.with_ymd_and_hms(2026, 5, 10, 8, 0, 0).unwrap();

        let (start, end) = find_free_slot(&pool, uid, "medium", 30, after)
            .await
            .expect("find_free_slot failed");

        assert!(start >= after, "slot must not be before `after`");
        assert_eq!(end - start, Duration::minutes(30));
        assert_eq!(start.hour(), 10, "medium energy should prefer 10am");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn find_free_slot_skips_conflicting_day(pool: PgPool) {
        let uid = new_user(&pool).await;
        // Insert a conflict at the 10am medium-energy slot on May 10
        let conflict_start = Utc.with_ymd_and_hms(2026, 5, 10, 10, 0, 0).unwrap();
        let conflict_end = Utc.with_ymd_and_hms(2026, 5, 10, 10, 30, 0).unwrap();
        sqlx::query(
            "INSERT INTO schedule_entries (user_id, task_type, date, scheduled_start, scheduled_end, status)
             VALUES ($1, 'custom', $2, $3, $4, 'planned')",
        )
        .bind(uid)
        .bind(chrono::NaiveDate::from_ymd_opt(2026, 5, 10).unwrap())
        .bind(conflict_start)
        .bind(conflict_end)
        .execute(&pool)
        .await
        .expect("failed to insert conflict");

        let after = Utc.with_ymd_and_hms(2026, 5, 10, 8, 0, 0).unwrap();
        let (start, _) = find_free_slot(&pool, uid, "medium", 30, after)
            .await
            .expect("find_free_slot failed");

        // May 10 is blocked — slot must fall on May 11 at 10am
        assert_eq!(start, Utc.with_ymd_and_hms(2026, 5, 11, 10, 0, 0).unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn find_free_slot_respects_energy_level(pool: PgPool) {
        let uid = new_user(&pool).await;
        let after = Utc.with_ymd_and_hms(2026, 5, 10, 0, 0, 0).unwrap();

        let (high_start, _) = find_free_slot(&pool, uid, "high", 30, after).await.unwrap();
        let (low_start, _) = find_free_slot(&pool, uid, "low", 30, after).await.unwrap();

        assert_eq!(high_start.hour(), 9, "high energy should prefer 9am");
        assert_eq!(low_start.hour(), 13, "low energy should prefer 1pm");
    }
}
