use async_trait::async_trait;
use chrono::{NaiveDate, NaiveTime};
use chrono_tz::Tz;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::timezone_anchor as db;
use crate::models::{TimezoneAnchor, TimezoneSource};
use crate::repository::timezone_anchor::TimezoneAnchorRepository;

pub struct PgTimezoneAnchorRepository {
    pool: PgPool,
}

impl PgTimezoneAnchorRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TimezoneAnchorRepository for PgTimezoneAnchorRepository {
    async fn list_through(
        &self,
        user_id: Uuid,
        through: NaiveDate,
    ) -> Result<Vec<TimezoneAnchor>, crate::Error> {
        db::list_through(&self.pool, user_id, through)
            .await
            .map_err(Into::into)
    }

    async fn add(
        &self,
        user_id: Uuid,
        effective_date: NaiveDate,
        effective_time: Option<NaiveTime>,
        zone: Tz,
        source: TimezoneSource,
        source_ref: Option<Uuid>,
        inference_group: Option<Uuid>,
    ) -> Result<TimezoneAnchor, crate::Error> {
        db::add(
            &self.pool,
            user_id,
            effective_date,
            effective_time,
            zone,
            source,
            source_ref,
            inference_group,
        )
        .await
        .map_err(Into::into)
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> Result<bool, crate::Error> {
        db::delete(&self.pool, id, user_id)
            .await
            .map_err(Into::into)
    }

    async fn delete_group(
        &self,
        user_id: Uuid,
        inference_group: Uuid,
    ) -> Result<u64, crate::Error> {
        db::delete_group(&self.pool, user_id, inference_group)
            .await
            .map_err(Into::into)
    }
}
