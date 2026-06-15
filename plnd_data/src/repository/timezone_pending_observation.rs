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
    /// `observation_count`, `first_seen`, and `last_seen`. The caller supplies
    /// the correct `first_seen` value (preserved from the existing row for a
    /// same-zone increment, or reset to `now_instant` on a zone flip) so the
    /// SQL layer never has to decide which case applies. The caller also
    /// supplies `observation_count` — it is not incremented in SQL.
    async fn upsert(
        &self,
        user_id: Uuid,
        observed_zone: Tz,
        observation_count: i32,
        first_seen: DateTime<Utc>,
        last_seen: DateTime<Utc>,
    ) -> Result<TimezonePendingObservation, crate::Error>;

    /// Mark the standoff as raised for `user_id` (idempotent).
    async fn mark_standoff(&self, user_id: Uuid) -> Result<(), crate::Error>;

    /// Delete the pending observation for `user_id` (promotion or dismissal).
    async fn clear(&self, user_id: Uuid) -> Result<(), crate::Error>;
}
