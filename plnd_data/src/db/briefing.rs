use chrono::NaiveDate;
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct YesterdaySnapshot {
    pub tasks_total: i64,
    pub tasks_done: i64,
    pub meals_planned: i64,
    pub meals_logged: i64,
}

#[tracing::instrument(
    skip(pool),
    fields(table = "schedule_entries", op = "yesterday_snapshot")
)]
pub async fn yesterday_snapshot(
    pool: &PgPool,
    user_id: Uuid,
    date: NaiveDate,
) -> Result<YesterdaySnapshot, DatabaseError> {
    // Post-#828, schedule_entries is task-only; meal anchors live in meal_anchor_instances.
    // meals_logged has no source until #829 restores completion tracking — return 0 for now.
    sqlx::query_as::<_, YesterdaySnapshot>(
        "WITH tasks AS (
            SELECT
                COUNT(*)                                      AS total,
                COUNT(*) FILTER (WHERE status = 'completed') AS done
            FROM schedule_entries
            WHERE user_id = $1 AND date = $2
         ),
         meals AS (
            SELECT COUNT(*) AS planned
            FROM meal_anchor_instances
            WHERE user_id = $1 AND date = $2
         )
         SELECT
             tasks.total   AS tasks_total,
             tasks.done    AS tasks_done,
             meals.planned AS meals_planned,
             0::bigint     AS meals_logged
         FROM tasks, meals",
    )
    .bind(user_id)
    .bind(date)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::{Duration, NaiveTime, Utc};
    use sqlx::PgPool;
    use uuid::Uuid;

    use super::*;
    use crate::db::{meal_anchor_instance, schedule, tasks, users};
    use crate::models::{CommitPlanInput, PlanEntryInput};

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
    // yesterday_snapshot
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn yesterday_snapshot_returns_zeros_for_new_user(pool: PgPool) {
        let uid = new_user(&pool).await;
        let yesterday = Utc::now().date_naive() - Duration::days(1);

        let snap = yesterday_snapshot(&pool, uid, yesterday).await.unwrap();

        assert_eq!(snap.tasks_total, 0);
        assert_eq!(snap.tasks_done, 0);
        assert_eq!(snap.meals_planned, 0);
        assert_eq!(snap.meals_logged, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn yesterday_snapshot_reflects_committed_plan(pool: PgPool) {
        let uid = new_user(&pool).await;
        let yesterday = Utc::now().date_naive() - Duration::days(1);

        // Commit 2 work entries + 1 meal entry dated yesterday
        let task_id = tasks::create_weekly_plan_task(&pool, uid, yesterday, 0)
            .await
            .expect("failed to create planning task")
            .task_id;

        let nine = NaiveTime::from_hms_opt(9, 0, 0).unwrap();
        let ten = NaiveTime::from_hms_opt(10, 0, 0).unwrap();
        let noon = NaiveTime::from_hms_opt(12, 0, 0).unwrap();

        let req = CommitPlanInput {
            plan_start: yesterday,
            plan_end: yesterday,
            planning_task_id: task_id,
            entries: vec![
                PlanEntryInput {
                    date: yesterday,
                    task_type: Some("work".to_string()),
                    title: Some("Morning work".to_string()),
                    scheduled_start: Some(nine),
                    after_anchor: None,
                    duration_minutes: None,
                    energy_required: None,
                    one_shot: None,
                },
                PlanEntryInput {
                    date: yesterday,
                    task_type: Some("work".to_string()),
                    title: Some("Afternoon work".to_string()),
                    scheduled_start: Some(ten),
                    after_anchor: None,
                    duration_minutes: None,
                    energy_required: None,
                    one_shot: None,
                },
            ],
            meal_entries: Vec::new(),
            replace: false,
            carryover_decisions: HashMap::new(),
            drop_reasons: HashMap::new(),
        };
        schedule::commit_plan(&pool, uid, &req).await.unwrap();

        // Add a meal anchor instance directly (post-#828 they live in their
        // own table, not in schedule_entries).
        meal_anchor_instance::add(&pool, uid, yesterday, "Lunch", noon, 60)
            .await
            .unwrap();

        // Mark one work entry as completed.
        sqlx::query(
            "UPDATE schedule_entries SET status = 'completed'
             WHERE user_id = $1 AND date = $2 AND title = 'Morning work'",
        )
        .bind(uid)
        .bind(yesterday)
        .execute(&pool)
        .await
        .unwrap();

        let snap = yesterday_snapshot(&pool, uid, yesterday).await.unwrap();

        assert_eq!(snap.tasks_total, 2, "2 task entries");
        assert_eq!(snap.tasks_done, 1, "1 completed task");
        assert_eq!(snap.meals_planned, 1, "1 meal anchor instance");
        // meals_logged stubbed to 0 until #829 restores completion tracking.
        assert_eq!(snap.meals_logged, 0);
    }
}
