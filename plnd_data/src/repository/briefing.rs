use async_trait::async_trait;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::db::briefing::YesterdaySnapshot;
use crate::db::error::DatabaseError;

#[async_trait]
pub trait BriefingRepository: Send + Sync {
    async fn yesterday_snapshot(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<YesterdaySnapshot, DatabaseError>;
}
