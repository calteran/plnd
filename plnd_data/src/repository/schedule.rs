use async_trait::async_trait;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::models::{CommitPlanInput, EntryPatch, OpenSlot, ScheduleEntry};
use crate::query_types::{PlanStatusResponse, PostSchedulePlanResponse, SchedulePeriodResponse};

/// Target slot for a reposition. Exactly one slot key — a floating task's
/// `after_anchor` or a paired task's `slot_meal_anchor_id`.
#[derive(Debug, Clone)]
pub enum SlotTarget {
    AfterAnchor(String),
    MealAnchor(Uuid),
}

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

    async fn update_entry(
        &self,
        user_id: Uuid,
        entry_id: Uuid,
        patch: &EntryPatch,
    ) -> Result<(), crate::Error>;

    async fn reposition_entry(
        &self,
        user_id: Uuid,
        entry_id: Uuid,
        date: NaiveDate,
        target: &SlotTarget,
        position: i32,
    ) -> Result<(), crate::Error>;

    async fn get_carryover(
        &self,
        user_id: Uuid,
        before: NaiveDate,
    ) -> Result<Vec<ScheduleEntry>, crate::Error>;

    async fn resolve_open_slots(
        &self,
        user_id: Uuid,
        plan_start: NaiveDate,
        plan_end: NaiveDate,
        locked: &[(NaiveDate, String)],
    ) -> Result<Vec<OpenSlot>, crate::Error>;
}
