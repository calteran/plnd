use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::UserPreferences;

/// Upsert preferences: creates the row with defaults if absent, then applies any provided fields.
#[tracing::instrument(skip(pool), fields(table = "preferences", op = "patch_preferences"))]
pub async fn patch_preferences(
    pool: &PgPool,
    user_id: Uuid,
    week_start_day: Option<i16>,
    planning_trigger_offset: Option<i16>,
    default_plan_length_days: Option<i16>,
    wake_time: Option<NaiveTime>,
) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences
           (user_id, week_start_day, planning_trigger_offset, default_plan_length_days, wake_time)
         VALUES ($1, COALESCE($2, 1), COALESCE($3, 0), COALESCE($4, 7), COALESCE($5, '07:00'))
         ON CONFLICT (user_id) DO UPDATE
           SET week_start_day           = COALESCE($2, user_preferences.week_start_day),
               planning_trigger_offset  = COALESCE($3, user_preferences.planning_trigger_offset),
               default_plan_length_days = COALESCE($4, user_preferences.default_plan_length_days),
               wake_time                = COALESCE($5, user_preferences.wake_time),
               updated_at               = NOW()
         RETURNING user_id, week_start_day, planning_trigger_offset,
                   default_plan_length_days, wake_time, created_at, updated_at",
    )
    .bind(user_id)
    .bind(week_start_day)
    .bind(planning_trigger_offset)
    .bind(default_plan_length_days)
    .bind(wake_time)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Get preferences for a user, creating a default row if none exists.
#[tracing::instrument(skip(pool), fields(table = "preferences", op = "get_or_create"))]
pub async fn get_or_create(pool: &PgPool, user_id: Uuid) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE
           SET updated_at = user_preferences.updated_at
         RETURNING user_id, week_start_day, planning_trigger_offset,
                   default_plan_length_days, wake_time, created_at, updated_at",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}
