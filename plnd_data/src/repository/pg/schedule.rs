use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::ScheduleEntry;
use crate::db::schedule::get_period;
use crate::repository::schedule::ScheduleRepository;

pub struct PgScheduleRepository {
    pool: PgPool,
}

impl PgScheduleRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ScheduleRepository for PgScheduleRepository {
    async fn get_day_entries(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<ScheduleEntry>, DatabaseError> {
        let period = get_period(&self.pool, user_id, date, date).await?;
        Ok(period.entries)
    }
}
