use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::briefing::{self, YesterdaySnapshot};

use crate::repository::briefing::BriefingRepository;

pub struct PgBriefingRepository {
    pool: PgPool,
}

impl PgBriefingRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl BriefingRepository for PgBriefingRepository {
    async fn yesterday_snapshot(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<YesterdaySnapshot,crate::Error> {
        briefing::yesterday_snapshot(&self.pool, user_id, date).await.map_err(Into::into)
    }
}
