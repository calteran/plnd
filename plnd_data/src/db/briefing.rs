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
    sqlx::query_as::<_, YesterdaySnapshot>(
        "SELECT
           COUNT(*) FILTER (WHERE task_type != 'meal')                       AS tasks_total,
           COUNT(*) FILTER (WHERE task_type != 'meal' AND status = 'completed') AS tasks_done,
           COUNT(*) FILTER (WHERE task_type = 'meal')                        AS meals_planned,
           COUNT(*) FILTER (WHERE task_type = 'meal' AND status = 'completed')  AS meals_logged
         FROM schedule_entries
         WHERE user_id = $1 AND date = $2",
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
    use crate::db::{schedule, tasks, users};
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
                    task_type: "work".to_string(),
                    task_ref_id: None,
                    task_ref_type: None,
                    title: Some("Morning work".to_string()),
                    scheduled_start: Some(nine),
                    after_anchor: None,
                    duration_minutes: None,
                    energy_required: None,
                },
                PlanEntryInput {
                    date: yesterday,
                    task_type: "work".to_string(),
                    task_ref_id: None,
                    task_ref_type: None,
                    title: Some("Afternoon work".to_string()),
                    scheduled_start: Some(ten),
                    after_anchor: None,
                    duration_minutes: None,
                    energy_required: None,
                },
                PlanEntryInput {
                    date: yesterday,
                    task_type: "meal".to_string(),
                    task_ref_id: None,
                    task_ref_type: None,
                    title: Some("Lunch".to_string()),
                    scheduled_start: Some(noon),
                    after_anchor: None,
                    duration_minutes: None,
                    energy_required: None,
                },
            ],
            replace: false,
            carryover_decisions: HashMap::new(),
        };
        schedule::commit_plan(&pool, uid, &req).await.unwrap();

        // Mark one work entry and the meal as completed
        sqlx::query(
            "UPDATE schedule_entries SET status = 'completed'
             WHERE user_id = $1 AND date = $2 AND title = 'Morning work'",
        )
        .bind(uid)
        .bind(yesterday)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "UPDATE schedule_entries SET status = 'completed'
             WHERE user_id = $1 AND date = $2 AND title = 'Lunch'",
        )
        .bind(uid)
        .bind(yesterday)
        .execute(&pool)
        .await
        .unwrap();

        let snap = yesterday_snapshot(&pool, uid, yesterday).await.unwrap();

        assert_eq!(snap.tasks_total, 2, "2 non-meal entries");
        assert_eq!(snap.tasks_done, 1, "1 completed non-meal entry");
        assert_eq!(snap.meals_planned, 1, "1 meal entry");
        assert_eq!(snap.meals_logged, 1, "1 completed meal entry");
    }
}
