use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;


use crate::db::schedule;
use crate::models::{CommitPlanInput, ScheduleEntry};
use crate::query_types::{PlanStatusResponse, PostSchedulePlanResponse, SchedulePeriodResponse};
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
    ) -> Result<Vec<ScheduleEntry>,crate::Error> {
        let period = schedule::get_period(&self.pool, user_id, date, date).await?;
        Ok(period.entries)
    }

    async fn get_period(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<SchedulePeriodResponse,crate::Error> {
        schedule::get_period(&self.pool, user_id, start, end).await.map_err(Into::into)
    }

    async fn get_plan_status(
        &self,
        user_id: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<PlanStatusResponse,crate::Error> {
        schedule::get_plan_status(&self.pool, user_id, start, end).await.map_err(Into::into)
    }

    async fn commit_plan(
        &self,
        user_id: Uuid,
        input: &CommitPlanInput,
    ) -> Result<PostSchedulePlanResponse,crate::Error> {
        schedule::commit_plan(&self.pool, user_id, input).await.map_err(Into::into)
    }

    async fn update_entry_status(
        &self,
        user_id: Uuid,
        entry_id: Uuid,
        status: &str,
    ) -> Result<(),crate::Error> {
        schedule::update_entry_status(&self.pool, user_id, entry_id, status).await.map_err(Into::into)
    }
}
