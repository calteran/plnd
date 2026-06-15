use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use sqlx::{PgPool, Row as _};
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::TimezonePendingObservation;

const COLUMNS: &str = "id, user_id, observed_zone, observation_count, \
     first_seen, last_seen, standoff_raised_at, created_at, updated_at";

/// Map a raw Postgres row into a [`TimezonePendingObservation`].
///
/// Called after every `SELECT` / `RETURNING` query because
/// `TimezonePendingObservation` does not derive `sqlx::FromRow` (the
/// `observed_zone: Tz` field cannot be decoded directly from TEXT by sqlx).
fn map_row(row: sqlx::postgres::PgRow) -> Result<TimezonePendingObservation, DatabaseError> {
    let zone_str: String = row
        .try_get("observed_zone")
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
    let observed_zone: Tz = zone_str
        .parse()
        .map_err(|_| DatabaseError::QueryError(format!("unknown IANA timezone: {zone_str:?}")))?;

    Ok(TimezonePendingObservation {
        id: row
            .try_get("id")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        user_id: row
            .try_get("user_id")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        observed_zone,
        observation_count: row
            .try_get("observation_count")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        first_seen: row
            .try_get("first_seen")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        last_seen: row
            .try_get("last_seen")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        standoff_raised_at: row
            .try_get("standoff_raised_at")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
    })
}

/// Return the pending observation for `user_id`, or `None` if none exists.
#[tracing::instrument(
    skip(pool),
    fields(table = "timezone_pending_observations", op = "get")
)]
pub async fn get(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<TimezonePendingObservation>, DatabaseError> {
    let maybe_row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM timezone_pending_observations WHERE user_id = $1"
    )))
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)?;

    maybe_row.map(map_row).transpose()
}

/// Insert or update the pending observation for `user_id` and return it.
///
/// On conflict (same `user_id`) the row is updated with the new
/// `observed_zone`, `observation_count`, `first_seen`, and `last_seen`.
/// The caller supplies the correct `first_seen` — preserved from the
/// existing row for a same-zone increment, or reset to `now_instant` on
/// a zone flip — so the SQL layer never has to make that decision.
/// The caller also supplies `observation_count` — it is not incremented
/// in SQL.
#[tracing::instrument(
    skip(pool),
    fields(table = "timezone_pending_observations", op = "upsert")
)]
pub async fn upsert(
    pool: &PgPool,
    user_id: Uuid,
    observed_zone: Tz,
    observation_count: i32,
    first_seen: DateTime<Utc>,
    last_seen: DateTime<Utc>,
) -> Result<TimezonePendingObservation, DatabaseError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO timezone_pending_observations \
            (user_id, observed_zone, observation_count, first_seen, last_seen) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (user_id) DO UPDATE SET \
            observed_zone = EXCLUDED.observed_zone, \
            observation_count = EXCLUDED.observation_count, \
            first_seen = EXCLUDED.first_seen, \
            last_seen = EXCLUDED.last_seen, \
            updated_at = NOW() \
         RETURNING {COLUMNS}"
    )))
    .bind(user_id)
    .bind(observed_zone.name())
    .bind(observation_count)
    .bind(first_seen)
    .bind(last_seen)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)?;

    map_row(row)
}

/// Mark the standoff as raised for `user_id` (idempotent — only sets
/// `standoff_raised_at` when it is currently `NULL`).
#[tracing::instrument(
    skip(pool),
    fields(table = "timezone_pending_observations", op = "mark_standoff")
)]
pub async fn mark_standoff(pool: &PgPool, user_id: Uuid) -> Result<(), DatabaseError> {
    sqlx::query(
        "UPDATE timezone_pending_observations \
         SET standoff_raised_at = NOW(), updated_at = NOW() \
         WHERE user_id = $1 AND standoff_raised_at IS NULL",
    )
    .bind(user_id)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(DatabaseError::from)
}

/// Delete the pending observation for `user_id` (promotion or dismissal).
#[tracing::instrument(
    skip(pool),
    fields(table = "timezone_pending_observations", op = "clear")
)]
pub async fn clear(pool: &PgPool, user_id: Uuid) -> Result<(), DatabaseError> {
    sqlx::query("DELETE FROM timezone_pending_observations WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(DatabaseError::from)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::users;
    use chrono::TimeZone as _;
    use chrono_tz::America::{Chicago, New_York};

    /// Create a throwaway user row so the FK on `timezone_pending_observations`
    /// is satisfied. Mirrors the pattern used in `plnd_data/src/db/preferences.rs`.
    async fn new_user(pool: &PgPool) -> Uuid {
        users::create(
            pool,
            &format!("{}@test.invalid", Uuid::new_v4()),
            None,
            None,
        )
        .await
        .expect("failed to create test user")
        .user_id
    }

    /// Verify that `upsert` stores the supplied `first_seen` on insert, preserves
    /// it across a same-zone update, and resets it on a zone-flip — i.e. that the
    /// SQL actually writes `EXCLUDED.first_seen` rather than keeping the original.
    #[sqlx::test(migrations = "./migrations")]
    async fn upsert_resets_first_seen_on_zone_change(pool: PgPool) {
        let uid = new_user(&pool).await;

        let t0 = chrono::Utc.with_ymd_and_hms(2026, 6, 1, 8, 0, 0).unwrap();
        let t1 = chrono::Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap();

        // (1) Fresh insert: first_seen should be exactly t0.
        let row = upsert(&pool, uid, New_York, 1, t0, t0).await.unwrap();
        assert_eq!(
            row.first_seen, t0,
            "fresh insert must store supplied first_seen"
        );
        assert_eq!(row.observation_count, 1);

        // (2) Same zone, count incremented — caller passes the preserved t0.
        //     first_seen must remain t0 (not silently become t1).
        let row = upsert(&pool, uid, New_York, 2, t0, t1).await.unwrap();
        assert_eq!(
            row.first_seen, t0,
            "same-zone update must keep the original first_seen"
        );
        assert_eq!(row.observation_count, 2);

        // (3) Zone flip to Chicago — caller passes fresh t1 as first_seen.
        //     first_seen must become t1 (the dwell clock is reset).
        let row = upsert(&pool, uid, Chicago, 1, t1, t1).await.unwrap();
        assert_eq!(
            row.first_seen, t1,
            "zone-flip must reset first_seen to the newly supplied value"
        );
        assert_eq!(row.observation_count, 1);
        assert_eq!(row.observed_zone, Chicago);
    }
}
