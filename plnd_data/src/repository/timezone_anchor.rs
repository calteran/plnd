use async_trait::async_trait;
use chrono::{NaiveDate, NaiveTime};
use chrono_tz::Tz;
use uuid::Uuid;

use crate::models::{TimezoneAnchor, TimezoneSource};

#[async_trait]
pub trait TimezoneAnchorRepository: Send + Sync {
    /// All anchors for `user_id` with `effective_date <= through`, ordered
    /// ascending by `(effective_date, effective_time)` with NULL `effective_time`
    /// sorting first within a date.
    async fn list_through(
        &self,
        user_id: Uuid,
        through: NaiveDate,
    ) -> Result<Vec<TimezoneAnchor>, crate::Error>;

    /// Insert a new anchor and return it.
    #[allow(clippy::too_many_arguments)]
    async fn add(
        &self,
        user_id: Uuid,
        effective_date: NaiveDate,
        effective_time: Option<NaiveTime>,
        zone: Tz,
        source: TimezoneSource,
        source_ref: Option<Uuid>,
        inference_group: Option<Uuid>,
    ) -> Result<TimezoneAnchor, crate::Error>;

    /// Delete the anchor with the given `id`, scoped to `user_id`.
    ///
    /// Returns `true` if a row was deleted, `false` if it did not exist or
    /// belongs to a different user.
    async fn delete(&self, id: Uuid, user_id: Uuid) -> Result<bool, crate::Error>;

    /// Delete all anchors in `inference_group`, scoped to `user_id`.
    ///
    /// Returns the number of rows deleted.
    async fn delete_group(
        &self,
        user_id: Uuid,
        inference_group: Uuid,
    ) -> Result<u64, crate::Error>;
}
