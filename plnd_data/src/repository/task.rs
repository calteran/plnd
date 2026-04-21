use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::Task;

#[async_trait]
pub trait TaskRepository: Send + Sync {
    #[allow(clippy::too_many_arguments)]
    async fn create_user_task(
        &self,
        user_id: Uuid,
        title: &str,
        energy_level: &str,
        date: NaiveDate,
        scheduled_at: Option<DateTime<Utc>>,
        duration_minutes: i32,
        after_milepost: Option<&str>,
    ) -> Result<Task, DatabaseError>;

    async fn create_weekly_plan_task(
        &self,
        user_id: Uuid,
        plan_start: NaiveDate,
        trigger_offset: i16,
    ) -> Result<Task, DatabaseError>;
}
