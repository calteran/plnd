use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A single in-flight contradicting device reading for a user (spec D9).
///
/// Maps the `timezone_pending_observations` table (migration 0048). At most one
/// row exists per user. The row is deleted once the disagreement resolves —
/// either promoted to a real `user`/`device` anchor, or dismissed.
///
/// Note: `sqlx::FromRow` is **not** derived because `observed_zone: Tz` cannot
/// be decoded directly from a TEXT column by sqlx. The repository layer maps the
/// raw IANA name string to `Tz` when constructing this struct.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimezonePendingObservation {
    pub id: Uuid,
    pub user_id: Uuid,
    /// The IANA timezone being observed on the device (e.g. `America/New_York`).
    pub observed_zone: Tz,
    /// How many times this zone has been observed since the row was created.
    pub observation_count: i32,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    /// Set when the D9 standoff prompt has been raised; `None` until then.
    pub standoff_raised_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
