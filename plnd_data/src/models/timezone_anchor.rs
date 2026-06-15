use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A record of the timezone a user was in (or is scheduled to be in) on a
/// given date, anchored to `effective_date` (and optionally `effective_time`
/// for mid-day crossings).
///
/// Maps the `timezone_change_anchors` table (migration 0047).
///
/// Note: `sqlx::FromRow` is **not** derived because `zone: Tz` cannot be
/// decoded directly from a TEXT column by sqlx. The repository layer maps the
/// raw IANA name string to `Tz` when constructing this struct.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimezoneAnchor {
    pub id: Uuid,
    pub user_id: Uuid,
    /// The date from which this timezone is in effect.
    pub effective_date: NaiveDate,
    /// Optional wall-clock time within `effective_date` when the change takes
    /// effect (e.g. for a mid-day flight landing). `None` means the whole day.
    pub effective_time: Option<NaiveTime>,
    /// The IANA timezone (e.g. `America/New_York`).
    pub zone: Tz,
    /// How this anchor was established: from the device, explicitly by the
    /// user, or inferred by the system.
    pub source: TimezoneSource,
    /// For `source = User` or `source = Inferred`: the ID of the originating
    /// record (e.g. a travel event or calendar entry).
    pub source_ref: Option<Uuid>,
    /// Groups anchors that were inferred together in a single pass (used to
    /// invalidate a batch when re-inferring).
    pub inference_group: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// How a [`TimezoneAnchor`] was established.
///
/// Maps to the DB CHECK constraint vocabulary: `'device'`, `'user'`, `'inferred'`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimezoneSource {
    /// Reported by the user's device (e.g. browser timezone at login).
    Device,
    /// Set explicitly by the user (e.g. a manual override or future travel entry).
    User,
    /// Derived by the system (e.g. inferred from a travel itinerary).
    Inferred,
}

impl TimezoneSource {
    /// The wire/DB string, matching the `source` CHECK constraint vocabulary.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Device => "device",
            Self::User => "user",
            Self::Inferred => "inferred",
        }
    }
}

impl TryFrom<&str> for TimezoneSource {
    type Error = String;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "device" => Ok(Self::Device),
            "user" => Ok(Self::User),
            "inferred" => Ok(Self::Inferred),
            other => Err(format!("unknown TimezoneSource: {other:?}")),
        }
    }
}
