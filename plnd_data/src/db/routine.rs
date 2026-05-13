use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::Routine;

/// List all routines for a user, ordered by created_at.
#[tracing::instrument(skip(pool), fields(table = "routines", op = "list"))]
pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> Result<Vec<Routine>, DatabaseError> {
    sqlx::query_as::<_, Routine>(
        "SELECT routine_id, user_id, task_type, title, recurrence_tag, recurrence_rule,
            time_window_start, time_window_end, duration_minutes, energy_required, is_anchor,
            created_at, updated_at
         FROM routines WHERE user_id = $1 ORDER BY created_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Insert a new routine, returning the created record.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(pool), fields(table = "routines", op = "create"))]
pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    task_type: &str,
    title: &str,
    recurrence_tag: Option<&str>,
    recurrence_rule: &str,
    time_window_start: Option<NaiveTime>,
    time_window_end: Option<NaiveTime>,
    duration_minutes: Option<i32>,
    energy_required: &str,
    is_anchor: bool,
) -> Result<Routine, DatabaseError> {
    sqlx::query_as::<_, Routine>(
        "INSERT INTO routines (
            user_id, task_type, title, recurrence_tag, recurrence_rule,
            time_window_start, time_window_end, duration_minutes,
            energy_required, is_anchor
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING routine_id, user_id, task_type, title, recurrence_tag, recurrence_rule,
            time_window_start, time_window_end, duration_minutes, energy_required, is_anchor,
            created_at, updated_at",
    )
    .bind(user_id)
    .bind(task_type)
    .bind(title)
    .bind(recurrence_tag)
    .bind(recurrence_rule)
    .bind(time_window_start)
    .bind(time_window_end)
    .bind(duration_minutes)
    .bind(energy_required)
    .bind(is_anchor)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Delete a routine. Returns true if a row was deleted, false if not found.
#[tracing::instrument(skip(pool), fields(table = "routines", op = "delete"))]
pub async fn delete(pool: &PgPool, routine_id: Uuid, user_id: Uuid) -> Result<bool, DatabaseError> {
    sqlx::query("DELETE FROM routines WHERE routine_id = $1 AND user_id = $2")
        .bind(routine_id)
        .bind(user_id)
        .execute(pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .map_err(DatabaseError::from)
}

/// Update a routine. Returns the updated record, or None if not found / not owned.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(pool), fields(table = "routines", op = "update"))]
pub async fn update(
    pool: &PgPool,
    routine_id: Uuid,
    user_id: Uuid,
    title: &str,
    recurrence_tag: Option<&str>,
    recurrence_rule: &str,
    time_window_start: Option<NaiveTime>,
    time_window_end: Option<NaiveTime>,
    duration_minutes: Option<i32>,
    energy_required: &str,
    is_anchor: bool,
) -> Result<Option<Routine>, DatabaseError> {
    sqlx::query_as::<_, Routine>(
        "UPDATE routines
         SET title = $3, recurrence_tag = $4, recurrence_rule = $5,
             time_window_start = $6, time_window_end = $7, duration_minutes = $8,
             energy_required = $9, is_anchor = $10, updated_at = NOW()
         WHERE routine_id = $1 AND user_id = $2
         RETURNING routine_id, user_id, task_type, title, recurrence_tag, recurrence_rule,
             time_window_start, time_window_end, duration_minutes, energy_required, is_anchor,
             created_at, updated_at",
    )
    .bind(routine_id)
    .bind(user_id)
    .bind(title)
    .bind(recurrence_tag)
    .bind(recurrence_rule)
    .bind(time_window_start)
    .bind(time_window_end)
    .bind(duration_minutes)
    .bind(energy_required)
    .bind(is_anchor)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::users;

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

    // -----------------------------------------------------------------------
    // list_for_user
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn list_for_user_returns_empty_for_new_user(pool: PgPool) {
        let uid = new_user(&pool).await;
        let result = list_for_user(&pool, uid).await.unwrap();
        assert!(result.is_empty());
    }

    // -----------------------------------------------------------------------
    // create
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn create_returns_template(pool: PgPool) {
        let uid = new_user(&pool).await;

        let t = create(
            &pool,
            uid,
            "general",
            "Breakfast",
            Some("daily"),
            "FREQ=DAILY",
            Some(NaiveTime::from_hms_opt(8, 0, 0).unwrap()),
            Some(NaiveTime::from_hms_opt(10, 0, 0).unwrap()),
            Some(30),
            "medium",
            false,
        )
        .await
        .expect("create failed");

        assert_eq!(t.user_id, uid);
        assert_eq!(t.task_type, "general");
        assert_eq!(t.title, "Breakfast");
        assert_eq!(t.recurrence_tag.as_deref(), Some("daily"));
        assert_eq!(t.recurrence_rule, "FREQ=DAILY");
        assert_eq!(t.energy_required, "medium");
        assert!(!t.is_anchor);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_monthly_routine_accepted(pool: PgPool) {
        // Regression: schedule_templates_recurrence_check (stale inline constraint from
        // migration 0011) was never dropped by 0031 due to a wrong constraint name.
        // 'monthly' and 'yearly' were blocked even though routines_recurrence_tag_check
        // (the correct constraint) allows them. Migration 0040 drops the stale constraint.
        let uid = new_user(&pool).await;
        let t = create(
            &pool,
            uid,
            "general",
            "Replace vacuum filters",
            Some("monthly"),
            "FREQ=MONTHLY",
            None,
            None,
            None,
            "medium",
            false,
        )
        .await
        .expect("monthly routine should be accepted");

        assert_eq!(t.recurrence_tag.as_deref(), Some("monthly"));
        assert_eq!(t.recurrence_rule, "FREQ=MONTHLY");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_weekly_routine_accepted(pool: PgPool) {
        let uid = new_user(&pool).await;
        let t = create(
            &pool,
            uid,
            "general",
            "Weekly review",
            Some("weekly"),
            "FREQ=WEEKLY",
            None,
            None,
            None,
            "medium",
            false,
        )
        .await
        .expect("weekly routine should be accepted");

        assert_eq!(t.recurrence_tag.as_deref(), Some("weekly"));
        assert_eq!(t.recurrence_rule, "FREQ=WEEKLY");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_yearly_routine_accepted(pool: PgPool) {
        // Regression: same stale constraint that blocked 'monthly' also blocked 'yearly'.
        let uid = new_user(&pool).await;
        let t = create(
            &pool,
            uid,
            "general",
            "Annual physical",
            Some("yearly"),
            "FREQ=YEARLY",
            None,
            None,
            None,
            "low",
            false,
        )
        .await
        .expect("yearly routine should be accepted");

        assert_eq!(t.recurrence_tag.as_deref(), Some("yearly"));
        assert_eq!(t.recurrence_rule, "FREQ=YEARLY");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_for_user_returns_created_templates(pool: PgPool) {
        let uid = new_user(&pool).await;

        create(
            &pool,
            uid,
            "general",
            "Breakfast",
            Some("daily"),
            "FREQ=DAILY",
            None,
            None,
            None,
            "medium",
            false,
        )
        .await
        .unwrap();
        create(
            &pool,
            uid,
            "exercise",
            "Walk",
            Some("weekdays"),
            "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
            None,
            None,
            None,
            "low",
            false,
        )
        .await
        .unwrap();

        let result = list_for_user(&pool, uid).await.unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|t| t.user_id == uid));
    }

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_true(pool: PgPool) {
        let uid = new_user(&pool).await;
        let t = create(
            &pool,
            uid,
            "general",
            "Breakfast",
            Some("daily"),
            "FREQ=DAILY",
            None,
            None,
            None,
            "medium",
            false,
        )
        .await
        .unwrap();

        let deleted = delete(&pool, t.routine_id, uid).await.unwrap();
        assert!(deleted);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_false_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        let deleted = delete(&pool, Uuid::new_v4(), uid).await.unwrap();
        assert!(!deleted);
    }

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn update_returns_updated_template(pool: PgPool) {
        let uid = new_user(&pool).await;
        let t = create(
            &pool,
            uid,
            "general",
            "Breakfast",
            Some("daily"),
            "FREQ=DAILY",
            None,
            None,
            None,
            "medium",
            false,
        )
        .await
        .unwrap();

        let updated = update(
            &pool,
            t.routine_id,
            uid,
            "Lunch",
            Some("weekdays"),
            "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
            None,
            None,
            None,
            "high",
            false,
        )
        .await
        .unwrap();

        assert!(updated.is_some());
        let updated = updated.unwrap();
        assert_eq!(updated.routine_id, t.routine_id);
        assert_eq!(updated.title, "Lunch");
        assert_eq!(updated.recurrence_tag.as_deref(), Some("weekdays"));
        assert_eq!(updated.recurrence_rule, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
        assert_eq!(updated.energy_required, "high");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_returns_none_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        let result = update(
            &pool,
            Uuid::new_v4(),
            uid,
            "Lunch",
            Some("daily"),
            "FREQ=DAILY",
            None,
            None,
            None,
            "medium",
            false,
        )
        .await
        .unwrap();
        assert!(result.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let t = create(
            &pool,
            uid_a,
            "general",
            "Breakfast",
            Some("daily"),
            "FREQ=DAILY",
            None,
            None,
            None,
            "medium",
            false,
        )
        .await
        .unwrap();

        // uid_b cannot update uid_a's routine
        let result = update(
            &pool,
            t.routine_id,
            uid_b,
            "Hacked",
            Some("daily"),
            "FREQ=DAILY",
            None,
            None,
            None,
            "medium",
            false,
        )
        .await
        .unwrap();
        assert!(result.is_none());

        // Original record must be unchanged
        let remaining = list_for_user(&pool, uid_a).await.unwrap();
        assert_eq!(remaining[0].title, "Breakfast");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let t = create(
            &pool,
            uid_a,
            "general",
            "Breakfast",
            Some("daily"),
            "FREQ=DAILY",
            None,
            None,
            None,
            "medium",
            false,
        )
        .await
        .unwrap();

        // uid_b cannot delete uid_a's routine
        let deleted = delete(&pool, t.routine_id, uid_b).await.unwrap();
        assert!(!deleted);

        // Record must still exist for uid_a
        let remaining = list_for_user(&pool, uid_a).await.unwrap();
        assert_eq!(remaining.len(), 1);
    }
}
