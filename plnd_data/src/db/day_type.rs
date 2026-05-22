use chrono::{NaiveDate, NaiveTime};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::DayType;
use crate::repository::day_type::DeleteDayTypeOutcome;

const COLUMNS: &str = "id, user_id, name, days_bitmask, wake_time, sleep_time, \
     is_cycle, cycle_length, anchor_date, cycle_bitmask, created_at";

/// List all day types for a user, ordered by created_at ascending.
#[tracing::instrument(skip(pool), fields(table = "user_day_types", op = "list"))]
pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> Result<Vec<DayType>, DatabaseError> {
    sqlx::query_as::<_, DayType>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM user_day_types WHERE user_id = $1 ORDER BY created_at ASC"
    )))
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Fetch a single day type by id, scoped to the owning user.
#[tracing::instrument(skip(pool), fields(table = "user_day_types", op = "get_by_id"))]
pub async fn get_by_id(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<DayType>, DatabaseError> {
    sqlx::query_as::<_, DayType>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM user_day_types WHERE id = $1 AND user_id = $2"
    )))
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Insert a new day type.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(pool), fields(table = "user_day_types", op = "create"))]
pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    days_bitmask: i32,
    wake_time: NaiveTime,
    sleep_time: NaiveTime,
    is_cycle: bool,
    cycle_length: Option<i32>,
    anchor_date: Option<NaiveDate>,
    cycle_bitmask: i32,
) -> Result<DayType, DatabaseError> {
    sqlx::query_as::<_, DayType>(sqlx::AssertSqlSafe(format!(
        "INSERT INTO user_day_types
            (user_id, name, days_bitmask, wake_time, sleep_time,
             is_cycle, cycle_length, anchor_date, cycle_bitmask)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING {COLUMNS}"
    )))
    .bind(user_id)
    .bind(name)
    .bind(days_bitmask)
    .bind(wake_time)
    .bind(sleep_time)
    .bind(is_cycle)
    .bind(cycle_length)
    .bind(anchor_date)
    .bind(cycle_bitmask)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Replace all mutable fields of an existing day type.
/// Returns `None` if not found.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(pool), fields(table = "user_day_types", op = "update"))]
pub async fn update(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    name: &str,
    days_bitmask: i32,
    wake_time: NaiveTime,
    sleep_time: NaiveTime,
    is_cycle: bool,
    cycle_length: Option<i32>,
    anchor_date: Option<NaiveDate>,
    cycle_bitmask: i32,
) -> Result<Option<DayType>, DatabaseError> {
    sqlx::query_as::<_, DayType>(sqlx::AssertSqlSafe(format!(
        "UPDATE user_day_types
         SET name = $3, days_bitmask = $4, wake_time = $5, sleep_time = $6,
             is_cycle = $7, cycle_length = $8, anchor_date = $9,
             cycle_bitmask = $10
         WHERE id = $1 AND user_id = $2
         RETURNING {COLUMNS}"
    )))
    .bind(id)
    .bind(user_id)
    .bind(name)
    .bind(days_bitmask)
    .bind(wake_time)
    .bind(sleep_time)
    .bind(is_cycle)
    .bind(cycle_length)
    .bind(anchor_date)
    .bind(cycle_bitmask)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Count day types owned by a user.
#[tracing::instrument(skip(pool), fields(table = "user_day_types", op = "count"))]
pub async fn count_for_user(pool: &PgPool, user_id: Uuid) -> Result<i64, DatabaseError> {
    sqlx::query_scalar("SELECT COUNT(*) FROM user_day_types WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(DatabaseError::from)
}

/// Atomically delete a day type, enforcing that the user keeps at least one.
///
/// Returns `LastType` if this is the only remaining type, or `NotFound` if
/// the id does not belong to the user.
#[tracing::instrument(skip(pool), fields(table = "user_day_types", op = "delete"))]
pub async fn delete(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<DeleteDayTypeOutcome, DatabaseError> {
    let result = sqlx::query(
        "DELETE FROM user_day_types
         WHERE id = $1
           AND user_id = $2
           AND (SELECT COUNT(*) FROM user_day_types WHERE user_id = $2) > 1",
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(DatabaseError::from)?;

    if result.rows_affected() > 0 {
        return Ok(DeleteDayTypeOutcome::Deleted);
    }

    // Diagnose why delete was blocked: NotFound or LastType.
    let exists: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM user_day_types WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(DatabaseError::from)?;

    match exists {
        None => Ok(DeleteDayTypeOutcome::NotFound),
        Some(_) => Ok(DeleteDayTypeOutcome::LastType),
    }
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

    fn wake() -> NaiveTime {
        NaiveTime::from_hms_opt(7, 0, 0).unwrap()
    }
    fn sleep() -> NaiveTime {
        NaiveTime::from_hms_opt(22, 0, 0).unwrap()
    }

    async fn make_type(pool: &PgPool, user_id: Uuid) -> DayType {
        create(
            pool,
            user_id,
            "Weekdays",
            62,
            wake(),
            sleep(),
            false,
            None,
            None,
            0,
        )
        .await
        .expect("create failed")
    }

    // -----------------------------------------------------------------------
    // list_for_user
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn list_for_user_returns_empty_for_new_user(pool: PgPool) {
        let uid = new_user(&pool).await;
        assert!(list_for_user(&pool, uid).await.unwrap().is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_for_user_returns_all_records(pool: PgPool) {
        let uid = new_user(&pool).await;
        make_type(&pool, uid).await;
        create(
            &pool,
            uid,
            "Weekends",
            65,
            wake(),
            sleep(),
            false,
            None,
            None,
            0,
        )
        .await
        .unwrap();

        let result = list_for_user(&pool, uid).await.unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|t| t.user_id == uid));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_for_user_excludes_other_users(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        make_type(&pool, uid_a).await;
        make_type(&pool, uid_b).await;

        let result_a = list_for_user(&pool, uid_a).await.unwrap();
        assert_eq!(result_a.len(), 1);
        assert_eq!(result_a[0].user_id, uid_a);
    }

    // -----------------------------------------------------------------------
    // create
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn create_returns_day_type(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dt = make_type(&pool, uid).await;

        assert_eq!(dt.user_id, uid);
        assert_eq!(dt.name, "Weekdays");
        assert_eq!(dt.days_bitmask, 62);
        assert_eq!(dt.wake_time, wake());
        assert_eq!(dt.sleep_time, sleep());
        assert!(!dt.is_cycle);
        assert!(dt.cycle_length.is_none());
        assert!(dt.anchor_date.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_cycle_type_stores_cycle_fields(pool: PgPool) {
        let uid = new_user(&pool).await;
        let anchor = chrono::NaiveDate::from_ymd_opt(2026, 1, 6).unwrap();
        let dt = create(
            &pool,
            uid,
            "Cycle",
            0,
            wake(),
            sleep(),
            true,
            Some(10),
            Some(anchor),
            0b0000010101,
        )
        .await
        .expect("create cycle failed");

        assert!(dt.is_cycle);
        assert_eq!(dt.cycle_length, Some(10));
        assert_eq!(dt.anchor_date, Some(anchor));
        assert_eq!(dt.days_bitmask, 0, "cycle type must have days_bitmask=0");
        assert_eq!(dt.cycle_bitmask, 0b0000010101);
    }

    // -----------------------------------------------------------------------
    // get_by_id
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn get_by_id_returns_record(pool: PgPool) {
        let uid = new_user(&pool).await;
        let created = make_type(&pool, uid).await;
        let found = get_by_id(&pool, created.id, uid).await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, created.id);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_by_id_unknown_returns_none(pool: PgPool) {
        let uid = new_user(&pool).await;
        let result = get_by_id(&pool, Uuid::new_v4(), uid).await.unwrap();
        assert!(result.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_by_id_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let dt = make_type(&pool, uid_a).await;
        let result = get_by_id(&pool, dt.id, uid_b).await.unwrap();
        assert!(result.is_none());
    }

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn update_changes_fields(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dt = make_type(&pool, uid).await;
        let new_wake = NaiveTime::from_hms_opt(6, 30, 0).unwrap();

        let updated = update(
            &pool,
            dt.id,
            uid,
            "Mornings",
            31,
            new_wake,
            sleep(),
            false,
            None,
            None,
            0,
        )
        .await
        .unwrap()
        .expect("update returned None");

        assert_eq!(updated.name, "Mornings");
        assert_eq!(updated.days_bitmask, 31);
        assert_eq!(updated.wake_time, new_wake);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_returns_none_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        let result = update(
            &pool,
            Uuid::new_v4(),
            uid,
            "X",
            0,
            wake(),
            sleep(),
            false,
            None,
            None,
            0,
        )
        .await
        .unwrap();
        assert!(result.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let dt = make_type(&pool, uid_a).await;

        let result = update(
            &pool,
            dt.id,
            uid_b,
            "Hijacked",
            0,
            wake(),
            sleep(),
            false,
            None,
            None,
            0,
        )
        .await
        .unwrap();
        assert!(result.is_none());

        let unchanged = get_by_id(&pool, dt.id, uid_a).await.unwrap().unwrap();
        assert_eq!(unchanged.name, "Weekdays");
    }

    // -----------------------------------------------------------------------
    // count_for_user
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn count_for_user_reflects_inserts(pool: PgPool) {
        let uid = new_user(&pool).await;
        assert_eq!(count_for_user(&pool, uid).await.unwrap(), 0);
        make_type(&pool, uid).await;
        assert_eq!(count_for_user(&pool, uid).await.unwrap(), 1);
        create(
            &pool,
            uid,
            "Weekends",
            65,
            wake(),
            sleep(),
            false,
            None,
            None,
            0,
        )
        .await
        .unwrap();
        assert_eq!(count_for_user(&pool, uid).await.unwrap(), 2);
    }

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_deleted_when_multiple_exist(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dt = make_type(&pool, uid).await;
        let second = create(
            &pool,
            uid,
            "Weekends",
            65,
            wake(),
            sleep(),
            false,
            None,
            None,
            0,
        )
        .await
        .unwrap();

        let outcome = delete(&pool, second.id, uid).await.unwrap();
        assert!(matches!(outcome, DeleteDayTypeOutcome::Deleted));
        assert_eq!(list_for_user(&pool, uid).await.unwrap().len(), 1);
        assert!(get_by_id(&pool, dt.id, uid).await.unwrap().is_some());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_last_type_when_only_one(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dt = make_type(&pool, uid).await;
        let outcome = delete(&pool, dt.id, uid).await.unwrap();
        assert!(matches!(outcome, DeleteDayTypeOutcome::LastType));
        assert_eq!(list_for_user(&pool, uid).await.unwrap().len(), 1);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_not_found_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        let outcome = delete(&pool, Uuid::new_v4(), uid).await.unwrap();
        assert!(matches!(outcome, DeleteDayTypeOutcome::NotFound));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let dt = make_type(&pool, uid_a).await;

        let outcome = delete(&pool, dt.id, uid_b).await.unwrap();
        assert!(matches!(outcome, DeleteDayTypeOutcome::NotFound));
        assert_eq!(list_for_user(&pool, uid_a).await.unwrap().len(), 1);
    }
}
