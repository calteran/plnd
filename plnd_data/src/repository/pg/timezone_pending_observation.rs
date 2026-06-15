use async_trait::async_trait;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::timezone_pending_observation as db;
use crate::models::TimezonePendingObservation;
use crate::repository::timezone_pending_observation::TimezonePendingObservationRepository;

pub struct PgTimezonePendingObservationRepository {
    pool: PgPool,
}

impl PgTimezonePendingObservationRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TimezonePendingObservationRepository for PgTimezonePendingObservationRepository {
    async fn get(&self, user_id: Uuid) -> Result<Option<TimezonePendingObservation>, crate::Error> {
        db::get(&self.pool, user_id).await.map_err(Into::into)
    }

    async fn upsert(
        &self,
        user_id: Uuid,
        observed_zone: Tz,
        observation_count: i32,
        last_seen: DateTime<Utc>,
    ) -> Result<TimezonePendingObservation, crate::Error> {
        db::upsert(
            &self.pool,
            user_id,
            observed_zone,
            observation_count,
            last_seen,
        )
        .await
        .map_err(Into::into)
    }

    async fn mark_standoff(&self, user_id: Uuid) -> Result<(), crate::Error> {
        db::mark_standoff(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

    async fn clear(&self, user_id: Uuid) -> Result<(), crate::Error> {
        db::clear(&self.pool, user_id).await.map_err(Into::into)
    }
}
