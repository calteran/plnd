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
