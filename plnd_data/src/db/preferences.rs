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
    wake_time: Option<NaiveTime>,
    planning_time: Option<NaiveTime>,
) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences
           (user_id, week_start_day, planning_trigger_offset, default_plan_length_days, wake_time, planning_time)
         VALUES ($1, COALESCE($2, 1), COALESCE($3, 0), COALESCE($4, 7), COALESCE($5, '07:00'), $6)
         ON CONFLICT (user_id) DO UPDATE
           SET week_start_day           = COALESCE($2, user_preferences.week_start_day),
               planning_trigger_offset  = COALESCE($3, user_preferences.planning_trigger_offset),
               default_plan_length_days = COALESCE($4, user_preferences.default_plan_length_days),
               wake_time                = COALESCE($5, user_preferences.wake_time),
               planning_time            = COALESCE($6, user_preferences.planning_time),
               updated_at               = NOW()
         RETURNING user_id, week_start_day, planning_trigger_offset,
                   default_plan_length_days, wake_time,
                   breakfast_window_start, breakfast_window_end,
                   lunch_window_start, lunch_window_end,
                   dinner_window_start, dinner_window_end,
                   planning_time, created_at, updated_at",
    )
    .bind(user_id)
    .bind(week_start_day)
    .bind(planning_trigger_offset)
    .bind(default_plan_length_days)
    .bind(wake_time)
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
                   default_plan_length_days, wake_time,
                   breakfast_window_start, breakfast_window_end,
                   lunch_window_start, lunch_window_end,
                   dinner_window_start, dinner_window_end,
                   planning_time, created_at, updated_at",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Upsert meal window time ranges on the user's preferences row.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(pool), fields(table = "preferences", op = "update_meal_windows"))]
pub async fn update_meal_windows(
    pool: &PgPool,
    user_id: Uuid,
    breakfast_window_start: Option<NaiveTime>,
    breakfast_window_end: Option<NaiveTime>,
    lunch_window_start: Option<NaiveTime>,
    lunch_window_end: Option<NaiveTime>,
    dinner_window_start: Option<NaiveTime>,
    dinner_window_end: Option<NaiveTime>,
) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences
           (user_id, breakfast_window_start, breakfast_window_end,
            lunch_window_start, lunch_window_end,
            dinner_window_start, dinner_window_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE
           SET breakfast_window_start = COALESCE($2, user_preferences.breakfast_window_start),
               breakfast_window_end   = COALESCE($3, user_preferences.breakfast_window_end),
               lunch_window_start     = COALESCE($4, user_preferences.lunch_window_start),
               lunch_window_end       = COALESCE($5, user_preferences.lunch_window_end),
               dinner_window_start    = COALESCE($6, user_preferences.dinner_window_start),
               dinner_window_end      = COALESCE($7, user_preferences.dinner_window_end),
               updated_at             = NOW()
         RETURNING user_id, week_start_day, planning_trigger_offset,
                   default_plan_length_days, wake_time,
                   breakfast_window_start, breakfast_window_end,
                   lunch_window_start, lunch_window_end,
                   dinner_window_start, dinner_window_end,
                   planning_time, created_at, updated_at",
    )
    .bind(user_id)
    .bind(breakfast_window_start)
    .bind(breakfast_window_end)
    .bind(lunch_window_start)
    .bind(lunch_window_end)
    .bind(dinner_window_start)
    .bind(dinner_window_end)
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
    use chrono::NaiveTime;

    /// Helper: create a throwaway user and return its UUID.
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
        assert_eq!(prefs.wake_time, NaiveTime::from_hms_opt(7, 0, 0).unwrap());
        assert_eq!(prefs.planning_time, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_or_create_is_idempotent(pool: PgPool) {
        let uid = new_user(&pool).await;
        let first = get_or_create(&pool, uid).await.unwrap();
        let second = get_or_create(&pool, uid).await.unwrap();

        assert_eq!(first.user_id, second.user_id);
        assert_eq!(first.week_start_day, second.week_start_day);
        assert_eq!(
            first.planning_trigger_offset,
            second.planning_trigger_offset
        );
        assert_eq!(
            first.default_plan_length_days,
            second.default_plan_length_days
        );
        assert_eq!(first.wake_time, second.wake_time);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_or_create_rejects_unknown_user(pool: PgPool) {
        // Documents that the user_preferences FK constraint enforces referential integrity:
        // inserting prefs for a non-existent user_id must fail.
        let err = get_or_create(&pool, Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, DatabaseError::QueryError(_)));
    }

    // -----------------------------------------------------------------------
    // patch_preferences
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn patch_preferences_updates_fields(pool: PgPool) {
        let uid = new_user(&pool).await;
        let wake = NaiveTime::from_hms_opt(8, 30, 0).unwrap();
        let prefs = patch_preferences(&pool, uid, Some(0), Some(10), Some(3), Some(wake), None)
            .await
            .unwrap();

        assert_eq!(prefs.week_start_day, 0);
        assert_eq!(prefs.planning_trigger_offset, 10);
        assert_eq!(prefs.default_plan_length_days, 3);
        assert_eq!(prefs.wake_time, wake);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn patch_preferences_partial_update(pool: PgPool) {
        let uid = new_user(&pool).await;
        let wake = NaiveTime::from_hms_opt(8, 0, 0).unwrap();
        // Establish a baseline with all fields set
        patch_preferences(&pool, uid, Some(0), Some(10), Some(5), Some(wake), None)
            .await
            .unwrap();

        // Only change week_start_day — others must be preserved
        let updated = patch_preferences(&pool, uid, Some(6), None, None, None, None)
            .await
            .unwrap();

        assert_eq!(updated.week_start_day, 6);
        assert_eq!(updated.planning_trigger_offset, 10);
        assert_eq!(updated.default_plan_length_days, 5);
        assert_eq!(updated.wake_time, wake);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn patch_preferences_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;

        patch_preferences(&pool, uid_a, Some(0), None, None, None, None)
            .await
            .unwrap();
        patch_preferences(&pool, uid_b, Some(6), None, None, None, None)
            .await
            .unwrap();

        // User A's preference must be unaffected by user B's patch
        let a_prefs = get_or_create(&pool, uid_a).await.unwrap();
        assert_eq!(a_prefs.week_start_day, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn patch_preferences_stores_planning_time(pool: PgPool) {
        let uid = new_user(&pool).await;
        let pt = NaiveTime::from_hms_opt(9, 0, 0).unwrap();
        let prefs = patch_preferences(&pool, uid, None, None, None, None, Some(pt))
            .await
            .unwrap();
        assert_eq!(prefs.planning_time, Some(pt));
    }

    // -----------------------------------------------------------------------
    // update_meal_windows
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn update_meal_windows_sets_values(pool: PgPool) {
        let uid = new_user(&pool).await;
        let start = NaiveTime::from_hms_opt(7, 0, 0).unwrap();
        let end = NaiveTime::from_hms_opt(9, 0, 0).unwrap();

        let prefs = update_meal_windows(&pool, uid, Some(start), Some(end), None, None, None, None)
            .await
            .unwrap();

        assert_eq!(prefs.breakfast_window_start, Some(start));
        assert_eq!(prefs.breakfast_window_end, Some(end));
        assert_eq!(prefs.lunch_window_start, None);
        assert_eq!(prefs.lunch_window_end, None);
        assert_eq!(prefs.dinner_window_start, None);
        assert_eq!(prefs.dinner_window_end, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_meal_windows_partial_preserves_existing(pool: PgPool) {
        let uid = new_user(&pool).await;
        let b_start = NaiveTime::from_hms_opt(7, 0, 0).unwrap();
        let b_end = NaiveTime::from_hms_opt(9, 0, 0).unwrap();
        let l_start = NaiveTime::from_hms_opt(12, 0, 0).unwrap();
        let l_end = NaiveTime::from_hms_opt(13, 0, 0).unwrap();

        // Set breakfast and lunch windows
        update_meal_windows(
            &pool,
            uid,
            Some(b_start),
            Some(b_end),
            Some(l_start),
            Some(l_end),
            None,
            None,
        )
        .await
        .unwrap();

        // Now only update breakfast — lunch must be preserved
        let new_b_start = NaiveTime::from_hms_opt(8, 0, 0).unwrap();
        let prefs =
            update_meal_windows(&pool, uid, Some(new_b_start), None, None, None, None, None)
                .await
                .unwrap();

        assert_eq!(prefs.breakfast_window_start, Some(new_b_start));
        assert_eq!(prefs.breakfast_window_end, Some(b_end));
        assert_eq!(prefs.lunch_window_start, Some(l_start));
        assert_eq!(prefs.lunch_window_end, Some(l_end));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_meal_windows_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;

        let a_start = NaiveTime::from_hms_opt(7, 0, 0).unwrap();
        let b_start = NaiveTime::from_hms_opt(9, 0, 0).unwrap();

        update_meal_windows(&pool, uid_a, Some(a_start), None, None, None, None, None)
            .await
            .unwrap();
        update_meal_windows(&pool, uid_b, Some(b_start), None, None, None, None, None)
            .await
            .unwrap();

        // User A's windows must be unaffected by user B's update
        let a_prefs = get_or_create(&pool, uid_a).await.unwrap();
        assert_eq!(a_prefs.breakfast_window_start, Some(a_start));
    }
}
