use chrono::{NaiveDate, NaiveTime};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::ScheduleType;
use crate::repository::schedule_type::DeleteScheduleTypeOutcome;

const COLUMNS: &str = "id, user_id, name, days_bitmask, wake_time, bed_time, is_cycle, cycle_length, anchor_date, created_at";

/// List all schedule types for a user, ordered by created_at ascending.
#[tracing::instrument(skip(pool), fields(table = "user_schedule_types", op = "list"))]
pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<ScheduleType>, DatabaseError> {
    sqlx::query_as::<_, ScheduleType>(&format!(
        "SELECT {COLUMNS} FROM user_schedule_types WHERE user_id = $1 ORDER BY created_at ASC"
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Fetch a single schedule type by id, scoped to the owning user.
#[tracing::instrument(skip(pool), fields(table = "user_schedule_types", op = "get_by_id"))]
pub async fn get_by_id(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<ScheduleType>, DatabaseError> {
    sqlx::query_as::<_, ScheduleType>(&format!(
        "SELECT {COLUMNS} FROM user_schedule_types WHERE id = $1 AND user_id = $2"
    ))
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Insert a new schedule type, returning the created record.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(pool), fields(table = "user_schedule_types", op = "create"))]
pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    days_bitmask: i32,
    wake_time: NaiveTime,
    bed_time: NaiveTime,
    is_cycle: bool,
    cycle_length: Option<i32>,
    anchor_date: Option<NaiveDate>,
) -> Result<ScheduleType, DatabaseError> {
    sqlx::query_as::<_, ScheduleType>(&format!(
        "INSERT INTO user_schedule_types
            (user_id, name, days_bitmask, wake_time, bed_time, is_cycle, cycle_length, anchor_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING {COLUMNS}"
    ))
    .bind(user_id)
    .bind(name)
    .bind(days_bitmask)
    .bind(wake_time)
    .bind(bed_time)
    .bind(is_cycle)
    .bind(cycle_length)
    .bind(anchor_date)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Replace all mutable fields of an existing schedule type. Returns `None` if not found.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(pool), fields(table = "user_schedule_types", op = "update"))]
pub async fn update(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    name: &str,
    days_bitmask: i32,
    wake_time: NaiveTime,
    bed_time: NaiveTime,
    is_cycle: bool,
    cycle_length: Option<i32>,
    anchor_date: Option<NaiveDate>,
) -> Result<Option<ScheduleType>, DatabaseError> {
    sqlx::query_as::<_, ScheduleType>(&format!(
        "UPDATE user_schedule_types
         SET name = $3, days_bitmask = $4, wake_time = $5, bed_time = $6,
             is_cycle = $7, cycle_length = $8, anchor_date = $9
         WHERE id = $1 AND user_id = $2
         RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(user_id)
    .bind(name)
    .bind(days_bitmask)
    .bind(wake_time)
    .bind(bed_time)
    .bind(is_cycle)
    .bind(cycle_length)
    .bind(anchor_date)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Count schedule types owned by a user.
#[tracing::instrument(skip(pool), fields(table = "user_schedule_types", op = "count"))]
pub async fn count_for_user(pool: &PgPool, user_id: Uuid) -> Result<i64, DatabaseError> {
    sqlx::query_scalar("SELECT COUNT(*) FROM user_schedule_types WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(DatabaseError::from)
}

/// Atomically delete a schedule type, enforcing the "user must keep at least one" invariant.
///
/// The count check is embedded in the DELETE predicate so concurrent deletes cannot both
/// pass the guard and leave the user with zero schedule types.  When `rows_affected == 0`
/// a follow-up EXISTS query determines whether the id was simply not found or whether it
/// was the last type for this user.
#[tracing::instrument(skip(pool), fields(table = "user_schedule_types", op = "delete"))]
pub async fn delete(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<DeleteScheduleTypeOutcome, DatabaseError> {
    let result = sqlx::query(
        "DELETE FROM user_schedule_types
         WHERE id = $1
           AND user_id = $2
           AND (SELECT COUNT(*) FROM user_schedule_types WHERE user_id = $2) > 1",
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(DatabaseError::from)?;

    if result.rows_affected() > 0 {
        return Ok(DeleteScheduleTypeOutcome::Deleted);
    }

    // rows_affected == 0: distinguish NotFound from LastType.
    // The DELETE and this EXISTS run in separate round-trips (no enclosing
    // transaction), so a third concurrent actor could remove the row between
    // the two queries.  In that extreme case we return NotFound rather than
    // LastType — a harmless inaccuracy since the guard held at DELETE time.
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_schedule_types WHERE id = $1 AND user_id = $2)",
    )
    .bind(id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)?;

    if exists {
        Ok(DeleteScheduleTypeOutcome::LastType)
    } else {
        Ok(DeleteScheduleTypeOutcome::NotFound)
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
    fn bed() -> NaiveTime {
        NaiveTime::from_hms_opt(22, 0, 0).unwrap()
    }

    async fn make_type(pool: &PgPool, user_id: Uuid) -> ScheduleType {
        create(
            pool,
            user_id,
            "Weekdays",
            62,
            wake(),
            bed(),
            false,
            None,
            None,
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
        let result = list_for_user(&pool, uid).await.unwrap();
        assert!(result.is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_for_user_returns_all_records(pool: PgPool) {
        let uid = new_user(&pool).await;
        make_type(&pool, uid).await;
        create(&pool, uid, "Weekends", 65, wake(), bed(), false, None, None)
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
    async fn create_returns_schedule_type(pool: PgPool) {
        let uid = new_user(&pool).await;
        let st = make_type(&pool, uid).await;

        assert_eq!(st.user_id, uid);
        assert_eq!(st.name, "Weekdays");
        assert_eq!(st.days_bitmask, 62); // Mon–Fri = bits 1-5
        assert_eq!(st.wake_time, wake());
        assert_eq!(st.bed_time, bed());
        assert!(!st.is_cycle);
        assert!(st.cycle_length.is_none());
        assert!(st.anchor_date.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_cycle_type_stores_cycle_fields(pool: PgPool) {
        let uid = new_user(&pool).await;
        let anchor = NaiveDate::from_ymd_opt(2026, 1, 6).unwrap();
        let st = create(
            &pool,
            uid,
            "Cycle",
            0,
            wake(),
            bed(),
            true,
            Some(10),
            Some(anchor),
        )
        .await
        .expect("create cycle failed");

        assert!(st.is_cycle);
        assert_eq!(st.cycle_length, Some(10));
        assert_eq!(st.anchor_date, Some(anchor));
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
        let st = make_type(&pool, uid_a).await;

        let result = get_by_id(&pool, st.id, uid_b).await.unwrap();
        assert!(result.is_none());
    }

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn update_changes_fields(pool: PgPool) {
        let uid = new_user(&pool).await;
        let st = make_type(&pool, uid).await;
        let new_wake = NaiveTime::from_hms_opt(6, 30, 0).unwrap();

        let updated = update(
            &pool,
            st.id,
            uid,
            "Mornings",
            31,
            new_wake,
            bed(),
            false,
            None,
            None,
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
            bed(),
            false,
            None,
            None,
        )
        .await
        .unwrap();
        assert!(result.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let st = make_type(&pool, uid_a).await;

        // uid_b cannot update uid_a's record — returns None
        let result = update(
            &pool,
            st.id,
            uid_b,
            "Hijacked",
            0,
            wake(),
            bed(),
            false,
            None,
            None,
        )
        .await
        .unwrap();
        assert!(result.is_none());

        // uid_a's record is unchanged
        let unchanged = get_by_id(&pool, st.id, uid_a).await.unwrap().unwrap();
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

        create(&pool, uid, "Weekends", 65, wake(), bed(), false, None, None)
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
        let st = make_type(&pool, uid).await;
        create(&pool, uid, "Weekends", 65, wake(), bed(), false, None, None)
            .await
            .unwrap();

        let outcome = delete(&pool, st.id, uid).await.unwrap();
        assert!(matches!(outcome, DeleteScheduleTypeOutcome::Deleted));
        assert_eq!(list_for_user(&pool, uid).await.unwrap().len(), 1);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_last_type_when_only_one(pool: PgPool) {
        let uid = new_user(&pool).await;
        let st = make_type(&pool, uid).await;

        let outcome = delete(&pool, st.id, uid).await.unwrap();
        assert!(matches!(outcome, DeleteScheduleTypeOutcome::LastType));
        // Record must still exist — the delete was rejected
        assert_eq!(list_for_user(&pool, uid).await.unwrap().len(), 1);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_not_found_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        let outcome = delete(&pool, Uuid::new_v4(), uid).await.unwrap();
        assert!(matches!(outcome, DeleteScheduleTypeOutcome::NotFound));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let st = make_type(&pool, uid_a).await;

        // uid_b cannot delete uid_a's record — returns NotFound (not visible to uid_b)
        let outcome = delete(&pool, st.id, uid_b).await.unwrap();
        assert!(matches!(outcome, DeleteScheduleTypeOutcome::NotFound));

        // Record still exists for uid_a
        assert_eq!(list_for_user(&pool, uid_a).await.unwrap().len(), 1);
    }
}
