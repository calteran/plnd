use async_trait::async_trait;
use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::schedule_template as db,
    models::ScheduleTemplate,
    repository::schedule_template::ScheduleTemplateRepository,
};

pub struct PgScheduleTemplateRepository {
    pool: PgPool,
}

impl PgScheduleTemplateRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ScheduleTemplateRepository for PgScheduleTemplateRepository {
    async fn list_templates_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<ScheduleTemplate>, crate::Error> {
        db::list_for_user(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

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
        is_milepost: bool,
        task_ref_id: Option<Uuid>,
        task_ref_type: Option<&str>,
    ) -> Result<ScheduleTemplate, crate::Error> {
        db::create(
            &self.pool,
            user_id,
            task_type,
            title,
            recurrence,
            recurrence_rule,
            time_window_start,
            time_window_end,
            duration_minutes,
            energy_required,
            is_milepost,
            task_ref_id,
            task_ref_type,
        )
        .await
        .map_err(Into::into)
    }

    async fn delete_template(
        &self,
        user_id: Uuid,
        template_id: Uuid,
    ) -> Result<bool, crate::Error> {
        db::delete(&self.pool, template_id, user_id)
            .await
            .map_err(Into::into)
    }
}
