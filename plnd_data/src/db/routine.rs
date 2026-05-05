use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::Routine;

/// List all routines for a user, ordered by created_at.
#[tracing::instrument(skip(pool), fields(table = "routines", op = "list"))]
pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> Result<Vec<Routine>, DatabaseError> {
    sqlx::query_as::<_, Routine>(
        "SELECT routine_id, user_id, task_type, title, recurrence, recurrence_rule,
            time_window_start, time_window_end, duration_minutes, energy_required, is_milepost,
            task_ref_id, task_ref_type, created_at, updated_at
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
    recurrence: &str,
    recurrence_rule: Option<&str>,
    time_window_start: Option<NaiveTime>,
    time_window_end: Option<NaiveTime>,
    duration_minutes: Option<i32>,
    energy_required: &str,
    is_milepost: bool,
    task_ref_id: Option<Uuid>,
    task_ref_type: Option<&str>,
) -> Result<Routine, DatabaseError> {
    sqlx::query_as::<_, Routine>(
        "INSERT INTO routines (
            user_id, task_type, title, recurrence, recurrence_rule,
            time_window_start, time_window_end, duration_minutes,
            energy_required, is_milepost, task_ref_id, task_ref_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING routine_id, user_id, task_type, title, recurrence, recurrence_rule,
            time_window_start, time_window_end, duration_minutes, energy_required, is_milepost,
            task_ref_id, task_ref_type, created_at, updated_at",
    )
    .bind(user_id)
    .bind(task_type)
    .bind(title)
    .bind(recurrence)
    .bind(recurrence_rule)
    .bind(time_window_start)
    .bind(time_window_end)
    .bind(duration_minutes)
    .bind(energy_required)
    .bind(is_milepost)
    .bind(task_ref_id)
    .bind(task_ref_type)
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
    recurrence: &str,
    recurrence_rule: Option<&str>,
    time_window_start: Option<NaiveTime>,
    time_window_end: Option<NaiveTime>,
    duration_minutes: Option<i32>,
    energy_required: &str,
    is_milepost: bool,
    task_ref_id: Option<Uuid>,
    task_ref_type: Option<&str>,
) -> Result<Option<Routine>, DatabaseError> {
    sqlx::query_as::<_, Routine>(
        "UPDATE routines
         SET title = $3, recurrence = $4, recurrence_rule = $5,
             time_window_start = $6, time_window_end = $7, duration_minutes = $8,
             energy_required = $9, is_milepost = $10, task_ref_id = $11,
             task_ref_type = $12, updated_at = NOW()
         WHERE routine_id = $1 AND user_id = $2
         RETURNING routine_id, user_id, task_type, title, recurrence, recurrence_rule,
             time_window_start, time_window_end, duration_minutes, energy_required, is_milepost,
             task_ref_id, task_ref_type, created_at, updated_at",
    )
    .bind(routine_id)
    .bind(user_id)
    .bind(title)
    .bind(recurrence)
    .bind(recurrence_rule)
    .bind(time_window_start)
    .bind(time_window_end)
    .bind(duration_minutes)
    .bind(energy_required)
    .bind(is_milepost)
    .bind(task_ref_id)
    .bind(task_ref_type)
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
            "meal",
            "Breakfast",
            "daily",
            None,
            Some(NaiveTime::from_hms_opt(8, 0, 0).unwrap()),
            Some(NaiveTime::from_hms_opt(10, 0, 0).unwrap()),
            Some(30),
            "medium",
            false,
            None,
            None,
        )
        .await
        .expect("create failed");

        assert_eq!(t.user_id, uid);
        assert_eq!(t.task_type, "meal");
        assert_eq!(t.title, "Breakfast");
        assert_eq!(t.recurrence, "daily");
        assert_eq!(t.energy_required, "medium");
        assert!(!t.is_milepost);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_for_user_returns_created_templates(pool: PgPool) {
        let uid = new_user(&pool).await;

        create(
            &pool,
            uid,
            "meal",
            "Breakfast",
            "daily",
            None,
            None,
            None,
            None,
            "medium",
            false,
            None,
            None,
        )
        .await
        .unwrap();
        create(
            &pool, uid, "exercise", "Walk", "weekdays", None, None, None, None, "low", false, None,
            None,
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
            "meal",
            "Breakfast",
            "daily",
            None,
            None,
            None,
            None,
            "medium",
            false,
            None,
            None,
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
            "meal",
            "Breakfast",
            "daily",
            None,
            None,
            None,
            None,
            "medium",
            false,
            None,
            None,
        )
        .await
        .unwrap();

        let updated = update(
            &pool,
            t.routine_id,
            uid,
            "Lunch",
            "weekdays",
            None,
            None,
            None,
            None,
            "high",
            false,
            None,
            None,
        )
        .await
        .unwrap();

        assert!(updated.is_some());
        let updated = updated.unwrap();
        assert_eq!(updated.routine_id, t.routine_id);
        assert_eq!(updated.title, "Lunch");
        assert_eq!(updated.recurrence, "weekdays");
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
            "daily",
            None,
            None,
            None,
            None,
            "medium",
            false,
            None,
            None,
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
            "meal",
            "Breakfast",
            "daily",
            None,
            None,
            None,
            None,
            "medium",
            false,
            None,
            None,
        )
        .await
        .unwrap();

        // uid_b cannot update uid_a's routine
        let result = update(
            &pool,
            t.routine_id,
            uid_b,
            "Hacked",
            "daily",
            None,
            None,
            None,
            None,
            "medium",
            false,
            None,
            None,
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
            "meal",
            "Breakfast",
            "daily",
            None,
            None,
            None,
            None,
            "medium",
            false,
            None,
            None,
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
