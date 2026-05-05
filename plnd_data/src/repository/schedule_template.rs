use async_trait::async_trait;
use chrono::NaiveTime;
use uuid::Uuid;

use crate::models::ScheduleTemplate;

#[async_trait]
pub trait ScheduleTemplateRepository: Send + Sync {
    async fn list_templates_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<ScheduleTemplate>, crate::Error>;

    #[allow(clippy::too_many_arguments)]
    async fn create_template(
        &self,
        user_id: Uuid,
        task_type: &str,
        title: &str,
        recurrence: &str,
        recurrence_rule: Option<&str>,
        time_window_start: Option<NaiveTime>,
        time_window_end: Option<NaiveTime>,
        duration_minutes: Option<i32>,
        energy_required: &str,
        is_anchor: bool,
        task_ref_id: Option<Uuid>,
        task_ref_type: Option<&str>,
    ) -> Result<ScheduleTemplate, crate::Error>;

    async fn delete_template(&self, user_id: Uuid, template_id: Uuid)
    -> Result<bool, crate::Error>;

    #[allow(clippy::too_many_arguments)]
    async fn update_template(
        &self,
        template_id: Uuid,
        user_id: Uuid,
        title: &str,
        recurrence: &str,
        recurrence_rule: Option<&str>,
        time_window_start: Option<NaiveTime>,
        time_window_end: Option<NaiveTime>,
        duration_minutes: Option<i32>,
        energy_required: &str,
        is_anchor: bool,
        task_ref_id: Option<Uuid>,
        task_ref_type: Option<&str>,
    ) -> Result<Option<ScheduleTemplate>, crate::Error>;
}
