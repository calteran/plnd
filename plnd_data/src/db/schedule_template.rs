use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::ScheduleTemplate;

/// List all schedule templates for a user, ordered by created_at.
#[tracing::instrument(skip(pool), fields(table = "schedule_templates", op = "list"))]
pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<ScheduleTemplate>, DatabaseError> {
    sqlx::query_as::<_, ScheduleTemplate>(
        "SELECT * FROM schedule_templates WHERE user_id = $1 ORDER BY created_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Insert a new schedule template, returning the created record.
#[tracing::instrument(skip(pool), fields(table = "schedule_templates", op = "create"))]
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
) -> Result<ScheduleTemplate, DatabaseError> {
    sqlx::query_as::<_, ScheduleTemplate>(
        "INSERT INTO schedule_templates (
            user_id, task_type, title, recurrence, recurrence_rule,
            time_window_start, time_window_end, duration_minutes,
            energy_required, is_milepost, task_ref_id, task_ref_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *",
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

/// Delete a schedule template. Returns true if a row was deleted, false if not found.
#[tracing::instrument(skip(pool), fields(table = "schedule_templates", op = "delete"))]
pub async fn delete(
    pool: &PgPool,
    user_id: Uuid,
    template_id: Uuid,
) -> Result<bool, DatabaseError> {
    sqlx::query(
        "DELETE FROM schedule_templates WHERE template_id = $1 AND user_id = $2",
    )
    .bind(template_id)
    .bind(user_id)
    .execute(pool)
    .await
    .map(|r| r.rows_affected() > 0)
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
            &pool, uid, "meal", "Breakfast", "daily", None, None, None, None, "medium", false,
            None, None,
        )
        .await
        .unwrap();
        create(
            &pool, uid, "exercise", "Walk", "weekdays", None, None, None, None, "low", false,
            None, None,
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
            &pool, uid, "meal", "Breakfast", "daily", None, None, None, None, "medium", false,
            None, None,
        )
        .await
        .unwrap();

        let deleted = delete(&pool, uid, t.template_id).await.unwrap();
        assert!(deleted);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_false_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        let deleted = delete(&pool, uid, Uuid::new_v4()).await.unwrap();
        assert!(!deleted);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let t = create(
            &pool, uid_a, "meal", "Breakfast", "daily", None, None, None, None, "medium",
            false, None, None,
        )
        .await
        .unwrap();

        // uid_b cannot delete uid_a's template
        let deleted = delete(&pool, uid_b, t.template_id).await.unwrap();
        assert!(!deleted);

        // Record must still exist for uid_a
        let remaining = list_for_user(&pool, uid_a).await.unwrap();
        assert_eq!(remaining.len(), 1);
    }
}
