use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::{PlannedMealEntry, PlannedMealEntryInput};

const COLUMNS: &str = "meal_entry_id, user_id, schedule_entry_id, meal_ref_id, \
                       meal_ref_type, title, created_at, updated_at";

// Qualified column list for queries that alias the table as `pme` (JOIN queries).
const PREFIXED_COLUMNS: &str = "pme.meal_entry_id, pme.user_id, pme.schedule_entry_id, \
                                pme.meal_ref_id, pme.meal_ref_type, pme.title, \
                                pme.created_at, pme.updated_at";

#[tracing::instrument(
    skip(pool),
    fields(table = "planned_meal_entries", op = "list_for_date")
)]
pub async fn list_for_date(
    pool: &PgPool,
    user_id: Uuid,
    date: NaiveDate,
) -> Result<Vec<PlannedMealEntry>, DatabaseError> {
    sqlx::query_as::<_, PlannedMealEntry>(&format!(
        "SELECT {PREFIXED_COLUMNS} \
         FROM planned_meal_entries pme \
         JOIN schedule_entries se ON se.entry_id = pme.schedule_entry_id \
         WHERE pme.user_id = $1 AND se.date = $2"
    ))
    .bind(user_id)
    .bind(date)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Insert a batch of planned-meal-entry rows.
///
/// The `executor` parameter accepts either a `&PgPool` (for standalone calls
/// from the repository layer) or `&mut Transaction<'_, Postgres>` (for use
/// inside a larger transactional unit such as `schedule::commit_plan`). This
/// keeps the SQL in one place rather than duplicating it across call sites.
#[tracing::instrument(
    skip(executor, entries),
    fields(table = "planned_meal_entries", op = "insert_many")
)]
pub async fn insert_many<'e, E>(
    executor: E,
    user_id: Uuid,
    entries: &[PlannedMealEntryInput],
) -> Result<Vec<PlannedMealEntry>, DatabaseError>
where
    E: sqlx::PgExecutor<'e>,
{
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let schedule_entry_ids: Vec<Uuid> = entries.iter().map(|e| e.schedule_entry_id).collect();
    let meal_ref_ids: Vec<Uuid> = entries.iter().map(|e| e.meal_ref_id).collect();
    let meal_ref_types: Vec<String> = entries.iter().map(|e| e.meal_ref_type.clone()).collect();
    let titles: Vec<Option<String>> = entries.iter().map(|e| e.title.clone()).collect();

    sqlx::query_as::<_, PlannedMealEntry>(&format!(
        "INSERT INTO planned_meal_entries \
             (user_id, schedule_entry_id, meal_ref_id, meal_ref_type, title) \
         SELECT $1, unnest($2::uuid[]), unnest($3::uuid[]), \
                unnest($4::varchar[]), unnest($5::varchar[]) \
         RETURNING {COLUMNS}"
    ))
    .bind(user_id)
    .bind(&schedule_entry_ids)
    .bind(&meal_ref_ids)
    .bind(&meal_ref_types)
    .bind(&titles)
    .fetch_all(executor)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(
    skip(pool),
    fields(table = "planned_meal_entries", op = "delete_for_period")
)]
pub async fn delete_for_period(
    pool: &PgPool,
    user_id: Uuid,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<u64, DatabaseError> {
    sqlx::query(
        "DELETE FROM planned_meal_entries \
         WHERE meal_entry_id IN ( \
             SELECT pme.meal_entry_id FROM planned_meal_entries pme \
             JOIN schedule_entries se ON se.entry_id = pme.schedule_entry_id \
             WHERE pme.user_id = $1 AND se.date BETWEEN $2 AND $3 \
         )",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .execute(pool)
    .await
    .map(|r| r.rows_affected())
    .map_err(DatabaseError::from)
}
