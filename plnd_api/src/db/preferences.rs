use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::{PatchPreferencesRequest, UserPreferences};

/// Update only the provided planning-horizon preference fields for a user.
pub async fn patch_preferences(
    pool: &PgPool,
    user_id: Uuid,
    req: &PatchPreferencesRequest,
) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "UPDATE user_preferences
         SET
           week_start_day           = COALESCE($2, week_start_day),
           planning_trigger_offset  = COALESCE($3, planning_trigger_offset),
           default_plan_length_days = COALESCE($4, default_plan_length_days),
           updated_at               = NOW()
         WHERE user_id = $1
         RETURNING user_id, week_start_day, planning_trigger_offset,
                   default_plan_length_days, created_at, updated_at",
    )
    .bind(user_id)
    .bind(req.week_start_day)
    .bind(req.planning_trigger_offset)
    .bind(req.default_plan_length_days)
    .fetch_one(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}

/// Get preferences for a user, creating a default row if none exists.
pub async fn get_or_create(pool: &PgPool, user_id: Uuid) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE
           SET updated_at = user_preferences.updated_at
         RETURNING user_id, week_start_day, planning_trigger_offset,
                   default_plan_length_days, created_at, updated_at",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}
