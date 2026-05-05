use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::tasks::{create_user_task, create_weekly_plan_task};
use crate::models::Task;
use crate::repository::task::TaskRepository;

pub struct PgTaskRepository {
    pool: PgPool,
}

impl PgTaskRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TaskRepository for PgTaskRepository {
    #[allow(clippy::too_many_arguments)]
    async fn create_user_task(
        &self,
        user_id: Uuid,
        title: &str,
        energy_level: &str,
        date: NaiveDate,
        scheduled_at: Option<DateTime<Utc>>,
        duration_minutes: i32,
        after_anchor: Option<&str>,
    ) -> Result<Task, crate::Error> {
        create_user_task(
            &self.pool,
            user_id,
            title,
            energy_level,
            date,
            scheduled_at,
            duration_minutes,
            after_anchor,
        )
        .await
        .map_err(Into::into)
    }

    async fn create_weekly_plan_task(
        &self,
        user_id: Uuid,
        plan_start: NaiveDate,
        trigger_offset: i16,
    ) -> Result<Task, crate::Error> {
        create_weekly_plan_task(&self.pool, user_id, plan_start, trigger_offset)
            .await
            .map_err(Into::into)
    }
}
