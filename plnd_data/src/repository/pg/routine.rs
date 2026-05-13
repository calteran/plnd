use async_trait::async_trait;
use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{db::routine as db, models::Routine, repository::routine::RoutineRepository};

pub struct PgRoutineRepository {
    pool: PgPool,
}

impl PgRoutineRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RoutineRepository for PgRoutineRepository {
    async fn list_routines_for_user(&self, user_id: Uuid) -> Result<Vec<Routine>, crate::Error> {
        db::list_for_user(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

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
    ) -> Result<Routine, crate::Error> {
        db::create(
            &self.pool,
            user_id,
            task_type,
            title,
            recurrence_tag,
            recurrence_rule,
            time_window_start,
            time_window_end,
            duration_minutes,
            energy_required,
            is_anchor,
        )
        .await
        .map_err(Into::into)
    }

    async fn delete_routine(&self, user_id: Uuid, routine_id: Uuid) -> Result<bool, crate::Error> {
        db::delete(&self.pool, routine_id, user_id)
            .await
            .map_err(Into::into)
    }

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
    ) -> Result<Option<Routine>, crate::Error> {
        db::update(
            &self.pool,
            routine_id,
            user_id,
            title,
            recurrence_tag,
            recurrence_rule,
            time_window_start,
            time_window_end,
            duration_minutes,
            energy_required,
            is_anchor,
        )
        .await
        .map_err(Into::into)
    }
}
