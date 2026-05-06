use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::UserPreferences;

/// Upsert preferences: creates the row with defaults if absent, then applies any provided fields.
#[tracing::instrument(skip(pool), fields(table = "preferences", op = "patch_preferences"))]
pub async fn patch_preferences(
    pool: &PgPool,
    user_id: Uuid,
    week_start_day: Option<i16>,
    planning_trigger_offset: Option<i16>,
    default_plan_length_days: Option<i16>,
    planning_time: Option<NaiveTime>,
) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences
           (user_id, week_start_day, planning_trigger_offset, default_plan_length_days, planning_time)
         VALUES ($1, COALESCE($2, 1), COALESCE($3, 0), COALESCE($4, 7), $5)
         ON CONFLICT (user_id) DO UPDATE
           SET week_start_day           = COALESCE($2, user_preferences.week_start_day),
               planning_trigger_offset  = COALESCE($3, user_preferences.planning_trigger_offset),
               default_plan_length_days = COALESCE($4, user_preferences.default_plan_length_days),
               planning_time            = COALESCE($5, user_preferences.planning_time),
               updated_at               = NOW()
         RETURNING user_id, week_start_day, planning_trigger_offset,
                   default_plan_length_days, planning_time, created_at, updated_at",
    )
    .bind(user_id)
    .bind(week_start_day)
    .bind(planning_trigger_offset)
    .bind(default_plan_length_days)
    .bind(planning_time)
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
                   default_plan_length_days, planning_time, created_at, updated_at",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::users;

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

    // -----------------------------------------------------------------------
    // get_or_create
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn get_or_create_returns_defaults(pool: PgPool) {
        let uid = new_user(&pool).await;
        let prefs = get_or_create(&pool, uid).await.unwrap();

        assert_eq!(prefs.user_id, uid);
        assert_eq!(prefs.week_start_day, 1);
        assert_eq!(prefs.planning_trigger_offset, 0);
        assert_eq!(prefs.default_plan_length_days, 7);
        assert_eq!(prefs.planning_time, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_or_create_is_idempotent(pool: PgPool) {
        let uid = new_user(&pool).await;
        let first = get_or_create(&pool, uid).await.unwrap();
        let second = get_or_create(&pool, uid).await.unwrap();

        assert_eq!(first.user_id, second.user_id);
        assert_eq!(first.week_start_day, second.week_start_day);
        assert_eq!(first.planning_trigger_offset, second.planning_trigger_offset);
        assert_eq!(first.default_plan_length_days, second.default_plan_length_days);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_or_create_rejects_unknown_user(pool: PgPool) {
        let err = get_or_create(&pool, Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DatabaseError::QueryError(_)));
    }

    // -----------------------------------------------------------------------
    // patch_preferences
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn patch_preferences_updates_fields(pool: PgPool) {
        let uid = new_user(&pool).await;
        let prefs = patch_preferences(&pool, uid, Some(0), Some(10), Some(3), None)
            .await
            .unwrap();

        assert_eq!(prefs.week_start_day, 0);
        assert_eq!(prefs.planning_trigger_offset, 10);
        assert_eq!(prefs.default_plan_length_days, 3);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn patch_preferences_partial_update(pool: PgPool) {
        let uid = new_user(&pool).await;
        patch_preferences(&pool, uid, Some(0), Some(10), Some(5), None)
            .await
            .unwrap();

        let updated = patch_preferences(&pool, uid, Some(6), None, None, None)
            .await
            .unwrap();

        assert_eq!(updated.week_start_day, 6);
        assert_eq!(updated.planning_trigger_offset, 10);
        assert_eq!(updated.default_plan_length_days, 5);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn patch_preferences_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;

        patch_preferences(&pool, uid_a, Some(0), None, None, None)
            .await
            .unwrap();
        patch_preferences(&pool, uid_b, Some(6), None, None, None)
            .await
            .unwrap();

        let a_prefs = get_or_create(&pool, uid_a).await.unwrap();
        assert_eq!(a_prefs.week_start_day, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn patch_preferences_stores_planning_time(pool: PgPool) {
        let uid = new_user(&pool).await;
        let pt = NaiveTime::from_hms_opt(9, 0, 0).unwrap();
        let prefs = patch_preferences(&pool, uid, None, None, None, Some(pt))
            .await
            .unwrap();
        assert_eq!(prefs.planning_time, Some(pt));
    }
}
