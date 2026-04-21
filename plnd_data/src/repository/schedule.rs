use async_trait::async_trait;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::ScheduleEntry;

#[async_trait]
pub trait ScheduleRepository: Send + Sync {
    async fn get_day_entries(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<ScheduleEntry>, DatabaseError>;
}
