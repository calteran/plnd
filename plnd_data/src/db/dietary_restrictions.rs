use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::DietaryRestriction;

/// List all dietary restrictions for a user, ordered by type then name.
#[tracing::instrument(skip(pool), fields(table = "dietary_restrictions", op = "list"))]
pub async fn list(pool: &PgPool, user_id: Uuid) -> Result<Vec<DietaryRestriction>, DatabaseError> {
    sqlx::query_as::<_, DietaryRestriction>(
        "SELECT restriction_id, user_id, restriction_type, name, notes, created_at, updated_at
         FROM dietary_restrictions
         WHERE user_id = $1
         ORDER BY restriction_type, name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Insert a new dietary restriction, returning the created record.
#[tracing::instrument(skip(pool), fields(table = "dietary_restrictions", op = "create"))]
pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    restriction_type: &str,
    name: &str,
    notes: Option<&str>,
) -> Result<DietaryRestriction, DatabaseError> {
    sqlx::query_as::<_, DietaryRestriction>(
        "INSERT INTO dietary_restrictions (user_id, restriction_type, name, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING restriction_id, user_id, restriction_type, name, notes, created_at, updated_at",
    )
    .bind(user_id)
    .bind(restriction_type)
    .bind(name)
    .bind(notes)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Update the notes on an existing restriction. Returns None if the restriction was not found
/// or does not belong to the given user.
#[tracing::instrument(skip(pool), fields(table = "dietary_restrictions", op = "update"))]
pub async fn update(
    pool: &PgPool,
    restriction_id: Uuid,
    user_id: Uuid,
    notes: Option<&str>,
) -> Result<Option<DietaryRestriction>, DatabaseError> {
    sqlx::query_as::<_, DietaryRestriction>(
        "UPDATE dietary_restrictions
         SET notes = COALESCE($3, notes),
             updated_at = NOW()
         WHERE restriction_id = $1 AND user_id = $2
         RETURNING restriction_id, user_id, restriction_type, name, notes, created_at, updated_at",
    )
    .bind(restriction_id)
    .bind(user_id)
    .bind(notes)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Delete a restriction. Returns true if a row was deleted, false if not found.
#[tracing::instrument(skip(pool), fields(table = "dietary_restrictions", op = "delete"))]
pub async fn delete(
    pool: &PgPool,
    restriction_id: Uuid,
    user_id: Uuid,
) -> Result<bool, DatabaseError> {
    sqlx::query("DELETE FROM dietary_restrictions WHERE restriction_id = $1 AND user_id = $2")
        .bind(restriction_id)
        .bind(user_id)
        .execute(pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .map_err(DatabaseError::from)
}
