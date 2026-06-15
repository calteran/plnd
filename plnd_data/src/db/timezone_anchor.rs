use chrono::{NaiveDate, NaiveTime};
use chrono_tz::Tz;
use sqlx::{PgPool, Row as _};
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::{TimezoneAnchor, TimezoneSource};

const COLUMNS: &str = "id, user_id, effective_date, effective_time, zone, source, \
     source_ref, inference_group, created_at, updated_at";

/// Map a raw Postgres row into a [`TimezoneAnchor`].
///
/// Called after every `SELECT` / `RETURNING` query because `TimezoneAnchor`
/// does not derive `sqlx::FromRow` (the `zone: Tz` field cannot be decoded
/// directly from TEXT by sqlx).
fn map_row(row: sqlx::postgres::PgRow) -> Result<TimezoneAnchor, DatabaseError> {
    let zone_str: String = row
        .try_get("zone")
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
    let zone: Tz = zone_str
        .parse()
        .map_err(|_| DatabaseError::QueryError(format!("unknown IANA timezone: {zone_str:?}")))?;

    let source_str: String = row
        .try_get("source")
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
    let source =
        TimezoneSource::try_from(source_str.as_str()).map_err(DatabaseError::QueryError)?;

    Ok(TimezoneAnchor {
        id: row
            .try_get("id")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        user_id: row
            .try_get("user_id")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        effective_date: row
            .try_get("effective_date")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        effective_time: row
            .try_get("effective_time")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        zone,
        source,
        source_ref: row
            .try_get("source_ref")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        inference_group: row
            .try_get("inference_group")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        created_at: row
            .try_get("created_at")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| DatabaseError::QueryError(e.to_string()))?,
    })
}

/// All anchors for `user_id` with `effective_date <= through`, ordered
/// ascending by `(effective_date, effective_time)` with NULL `effective_time`
/// sorting first within a date (a whole-day switch precedes timed switches).
#[tracing::instrument(
    skip(pool),
    fields(table = "timezone_change_anchors", op = "list_through")
)]
pub async fn list_through(
    pool: &PgPool,
    user_id: Uuid,
    through: NaiveDate,
) -> Result<Vec<TimezoneAnchor>, DatabaseError> {
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM timezone_change_anchors \
         WHERE user_id = $1 AND effective_date <= $2 \
         ORDER BY effective_date ASC, effective_time ASC NULLS FIRST"
    )))
    .bind(user_id)
    .bind(through)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)?;

    rows.into_iter().map(map_row).collect()
}

/// Insert a new anchor and return it.
#[tracing::instrument(skip(pool), fields(table = "timezone_change_anchors", op = "add"))]
#[allow(clippy::too_many_arguments)]
pub async fn add(
    pool: &PgPool,
    user_id: Uuid,
    effective_date: NaiveDate,
    effective_time: Option<NaiveTime>,
    zone: Tz,
    source: TimezoneSource,
    source_ref: Option<Uuid>,
    inference_group: Option<Uuid>,
) -> Result<TimezoneAnchor, DatabaseError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO timezone_change_anchors \
            (user_id, effective_date, effective_time, zone, source, source_ref, inference_group) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         RETURNING {COLUMNS}"
    )))
    .bind(user_id)
    .bind(effective_date)
    .bind(effective_time)
    .bind(zone.name())
    .bind(source.as_str())
    .bind(source_ref)
    .bind(inference_group)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)?;

    map_row(row)
}

/// Delete the anchor with the given `id`, scoped to `user_id`.
///
/// Returns `true` if a row was deleted, `false` if it did not exist or belongs
/// to a different user.
#[tracing::instrument(skip(pool), fields(table = "timezone_change_anchors", op = "delete"))]
pub async fn delete(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<bool, DatabaseError> {
    sqlx::query("DELETE FROM timezone_change_anchors WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .map_err(DatabaseError::from)
}

/// Delete all anchors belonging to `inference_group`, scoped to `user_id`.
///
/// Returns the number of rows deleted.
#[tracing::instrument(
    skip(pool),
    fields(table = "timezone_change_anchors", op = "delete_group")
)]
pub async fn delete_group(
    pool: &PgPool,
    user_id: Uuid,
    inference_group: Uuid,
) -> Result<u64, DatabaseError> {
    sqlx::query(
        "DELETE FROM timezone_change_anchors \
         WHERE user_id = $1 AND inference_group = $2",
    )
    .bind(user_id)
    .bind(inference_group)
    .execute(pool)
    .await
    .map(|r| r.rows_affected())
    .map_err(DatabaseError::from)
}
