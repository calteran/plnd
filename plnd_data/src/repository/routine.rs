use async_trait::async_trait;
use chrono::NaiveTime;
use uuid::Uuid;

use crate::models::Routine;

#[async_trait]
pub trait RoutineRepository: Send + Sync {
    async fn list_routines_for_user(&self, user_id: Uuid) -> Result<Vec<Routine>, crate::Error>;

    #[allow(clippy::too_many_arguments)]
    async fn create_routine(
        &self,
        user_id: Uuid,
        task_type: &str,
        title: &str,
        recurrence_tag: Option<&str>,
        recurrence_rule: &str,
        time_window_start: Option<NaiveTime>,
        time_window_end: Option<NaiveTime>,
        duration_minutes: Option<i32>,
        energy_required: &str,
        is_anchor: bool,
    ) -> Result<Routine, crate::Error>;

    async fn delete_routine(&self, user_id: Uuid, routine_id: Uuid) -> Result<bool, crate::Error>;

    #[allow(clippy::too_many_arguments)]
    async fn update_routine(
        &self,
        routine_id: Uuid,
        user_id: Uuid,
        title: &str,
        recurrence_tag: Option<&str>,
        recurrence_rule: &str,
        time_window_start: Option<NaiveTime>,
        time_window_end: Option<NaiveTime>,
        duration_minutes: Option<i32>,
        energy_required: &str,
        is_anchor: bool,
    ) -> Result<Option<Routine>, crate::Error>;
}
