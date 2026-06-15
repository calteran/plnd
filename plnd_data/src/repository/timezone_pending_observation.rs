use async_trait::async_trait;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use uuid::Uuid;

use crate::models::TimezonePendingObservation;

#[async_trait]
pub trait TimezonePendingObservationRepository: Send + Sync {
    /// Return the pending observation for `user_id`, or `None` if none exists.
    async fn get(&self, user_id: Uuid) -> Result<Option<TimezonePendingObservation>, crate::Error>;

    /// Insert or update the pending observation for `user_id` and return it.
    ///
    /// On conflict the row is updated with the new `observed_zone`,
    /// `observation_count`, and `last_seen`; `first_seen` and `created_at` are
    /// preserved. The caller supplies `observation_count` — it is not
    /// incremented in SQL.
    async fn upsert(
        &self,
        user_id: Uuid,
        observed_zone: Tz,
        observation_count: i32,
        last_seen: DateTime<Utc>,
    ) -> Result<TimezonePendingObservation, crate::Error>;

    /// Mark the standoff as raised for `user_id` (idempotent).
    async fn mark_standoff(&self, user_id: Uuid) -> Result<(), crate::Error>;

    /// Delete the pending observation for `user_id` (promotion or dismissal).
    async fn clear(&self, user_id: Uuid) -> Result<(), crate::Error>;
}
