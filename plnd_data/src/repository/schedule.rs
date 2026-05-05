use async_trait::async_trait;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::models::{CommitPlanInput, ScheduleEntry};
use crate::query_types::{PlanStatusResponse, PostSchedulePlanResponse, SchedulePeriodResponse};

#[async_trait]
pub trait ScheduleRepository: Send + Sync {
    async fn get_day_entries(
        &self,
        user_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<ScheduleEntry>, crate::Error>;

    async fn get_period(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<SchedulePeriodResponse, crate::Error>;

    async fn get_plan_status(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<PlanStatusResponse, crate::Error>;

    async fn commit_plan(
        &self,
        user_id: Uuid,
        input: &CommitPlanInput,
    ) -> Result<PostSchedulePlanResponse, crate::Error>;

    async fn update_entry_status(
        &self,
        user_id: Uuid,
        entry_id: Uuid,
        status: &str,
    ) -> Result<(), crate::Error>;

    async fn get_carryover(
        &self,
        user_id: Uuid,
        before: NaiveDate,
    ) -> Result<Vec<ScheduleEntry>, crate::Error>;
}
