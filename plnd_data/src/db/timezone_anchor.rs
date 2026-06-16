use chrono::{NaiveDate, NaiveTime};
use chrono_tz::Tz;
use sqlx::{PgPool, Row as _};
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::{TimezoneAnchor, TimezoneSource};
use crate::query_types::TimezoneAnchorWithSource;

const COLUMNS: &str = "id, user_id, effective_date, effective_time, zone, source, \
     source_ref, inference_group, created_at, updated_at";

/// Same columns as [`COLUMNS`], qualified with the `a` alias for the
/// `timezone_change_anchors` table in joined queries. The output column names
/// are unchanged (`id`, `user_id`, …), so [`map_row`] reads them by name.
const QUALIFIED_COLUMNS: &str = "a.id, a.user_id, a.effective_date, a.effective_time, a.zone, \
     a.source, a.source_ref, a.inference_group, a.created_at, a.updated_at";

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

/// Map a joined row into a [`TimezoneAnchorWithSource`], reading the
/// `source_title` column before delegating the anchor columns to [`map_row`].
fn map_row_with_source(
    row: sqlx::postgres::PgRow,
) -> Result<TimezoneAnchorWithSource, DatabaseError> {
    let source_title: Option<String> = row
        .try_get("source_title")
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
    let anchor = map_row(row)?;
    Ok(TimezoneAnchorWithSource {
        anchor,
        source_title,
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

/// Like [`list_through`], but also resolves each anchor's `source_ref` to the
/// originating task's title via a LEFT JOIN on `tasks.task_id`.
///
/// `source_title` is `None` when the anchor has no `source_ref` or the
/// referenced task no longer exists. Ordering matches `list_through`.
#[tracing::instrument(
    skip(pool),
    fields(table = "timezone_change_anchors", op = "list_through_with_source")
)]
pub async fn list_through_with_source(
    pool: &PgPool,
    user_id: Uuid,
    through: NaiveDate,
) -> Result<Vec<TimezoneAnchorWithSource>, DatabaseError> {
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS}, t.title AS source_title \
         FROM timezone_change_anchors a \
         LEFT JOIN tasks t ON t.task_id = a.source_ref \
         WHERE a.user_id = $1 AND a.effective_date <= $2 \
         ORDER BY a.effective_date ASC, a.effective_time ASC NULLS FIRST",
        COLUMNS = QUALIFIED_COLUMNS
    )))
    .bind(user_id)
    .bind(through)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)?;

    rows.into_iter().map(map_row_with_source).collect()
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{tasks, users};
    use chrono::NaiveTime;

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

    #[sqlx::test]
    async fn list_through_with_source_resolves_task_title(pool: PgPool) {
        let user_id = new_user(&pool).await;
        let travel_date = NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();

        // A task to act as the inferred anchor's source.
        let task = tasks::create_user_task(
            &pool,
            user_id,
            "Flight to DEN",
            "medium",
            travel_date,
            None,
            120,
            Some("breakfast"),
            false,
        )
        .await
        .expect("create task");

        // Inferred anchor referencing the task (intra-day).
        add(
            &pool,
            user_id,
            travel_date,
            Some(NaiveTime::from_hms_opt(14, 0, 0).unwrap()),
            chrono_tz::America::Denver,
            TimezoneSource::Inferred,
            Some(task.task_id),
            Some(Uuid::new_v4()),
        )
        .await
        .expect("add inferred anchor");

        // A device anchor on an earlier date with no source_ref.
        add(
            &pool,
            user_id,
            NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            None,
            chrono_tz::America::New_York,
            TimezoneSource::Device,
            None,
            None,
        )
        .await
        .expect("add device anchor");

        let rows = list_through_with_source(&pool, user_id, travel_date)
            .await
            .expect("list_through_with_source");

        // Ordered ascending by (date, time): device (6-1) first, inferred (7-1) second.
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].anchor.source, TimezoneSource::Device);
        assert_eq!(rows[0].source_title, None);
        assert_eq!(rows[1].anchor.source, TimezoneSource::Inferred);
        assert_eq!(rows[1].source_title, Some("Flight to DEN".to_string()));
    }

    #[sqlx::test]
    async fn list_through_with_source_null_for_dangling_ref(pool: PgPool) {
        let user_id = new_user(&pool).await;
        let date = NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();

        // source_ref points at a task that does not exist.
        add(
            &pool,
            user_id,
            date,
            None,
            chrono_tz::America::Denver,
            TimezoneSource::Inferred,
            Some(Uuid::new_v4()),
            Some(Uuid::new_v4()),
        )
        .await
        .expect("add anchor with dangling source_ref");

        let rows = list_through_with_source(&pool, user_id, date)
            .await
            .expect("list_through_with_source");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_title, None);
    }
}
