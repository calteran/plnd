use async_trait::async_trait;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::models::{PlannedMealEntry, PlannedMealEntryInput};

#[async_trait]
pub trait MealPlanRepository: Send + Sync {
    async fn list_for_date(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<PlannedMealEntry>, crate::Error>;

    async fn list_for_period(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<PlannedMealEntry>, crate::Error>;

    async fn insert_many(
        &self,
        user_id: Uuid,
        entries: &[PlannedMealEntryInput],
    ) -> Result<Vec<PlannedMealEntry>, crate::Error>;

    async fn delete_for_period(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<u64, crate::Error>;
}
