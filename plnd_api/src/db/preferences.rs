use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::UserPreferences;

/// Get preferences for a user, creating a default row if none exists.
pub async fn get_or_create(pool: &PgPool, user_id: Uuid) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE
           SET updated_at = user_preferences.updated_at
         RETURNING user_id, theme, created_at, updated_at",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}

/// Update preferences for a user. Fields set to None are left unchanged.
pub async fn upsert(
    pool: &PgPool,
    user_id: Uuid,
    theme: Option<&str>,
) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences (user_id, theme)
         VALUES ($1, COALESCE($2, 'system'))
         ON CONFLICT (user_id) DO UPDATE
           SET theme      = COALESCE($2, user_preferences.theme),
               updated_at = NOW()
         RETURNING user_id, theme, created_at, updated_at",
    )
    .bind(user_id)
    .bind(theme)
    .fetch_one(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}
