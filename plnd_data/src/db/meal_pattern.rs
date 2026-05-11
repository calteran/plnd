use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::MealPatternEntry;

const COLUMNS: &str =
    "id, day_type_id, name, preferred_time, tolerance_minutes, sort_order, created_at";

// Qualified column list for queries that alias the table as `mpe` (JOIN queries).
const PREFIXED_COLUMNS: &str = "mpe.id, mpe.day_type_id, mpe.name, mpe.preferred_time, \
     mpe.tolerance_minutes, mpe.sort_order, mpe.created_at";

#[tracing::instrument(skip(pool), fields(table = "meal_pattern_entries", op = "list"))]
pub async fn list_for_day_type(
    pool: &PgPool,
    day_type_id: Uuid,
) -> Result<Vec<MealPatternEntry>, DatabaseError> {
    sqlx::query_as::<_, MealPatternEntry>(&format!(
        "SELECT {COLUMNS} FROM meal_pattern_entries \
         WHERE day_type_id = $1 ORDER BY sort_order ASC"
    ))
    .bind(day_type_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "meal_pattern_entries", op = "get_by_id"))]
pub async fn get_by_id(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<MealPatternEntry>, DatabaseError> {
    sqlx::query_as::<_, MealPatternEntry>(&format!(
        "SELECT {PREFIXED_COLUMNS} \
         FROM meal_pattern_entries mpe \
         JOIN user_day_types udt ON udt.id = mpe.day_type_id \
         WHERE mpe.id = $1 AND udt.user_id = $2"
    ))
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "meal_pattern_entries", op = "create"))]
pub async fn create(
    pool: &PgPool,
    day_type_id: Uuid,
    name: &str,
    preferred_time: NaiveTime,
    tolerance_minutes: i32,
    sort_order: i32,
) -> Result<MealPatternEntry, DatabaseError> {
    sqlx::query_as::<_, MealPatternEntry>(&format!(
        "INSERT INTO meal_pattern_entries \
             (day_type_id, name, preferred_time, tolerance_minutes, sort_order) \
         VALUES ($1, $2, $3, $4, $5) \
         RETURNING {COLUMNS}"
    ))
    .bind(day_type_id)
    .bind(name)
    .bind(preferred_time)
    .bind(tolerance_minutes)
    .bind(sort_order)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "meal_pattern_entries", op = "update"))]
pub async fn update(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    name: &str,
    preferred_time: NaiveTime,
    tolerance_minutes: i32,
    sort_order: i32,
) -> Result<Option<MealPatternEntry>, DatabaseError> {
    sqlx::query_as::<_, MealPatternEntry>(&format!(
        "UPDATE meal_pattern_entries \
         SET name = $3, preferred_time = $4, tolerance_minutes = $5, sort_order = $6 \
         WHERE id = $1 \
           AND day_type_id IN (SELECT id FROM user_day_types WHERE user_id = $2) \
         RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(user_id)
    .bind(name)
    .bind(preferred_time)
    .bind(tolerance_minutes)
    .bind(sort_order)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "meal_pattern_entries", op = "delete"))]
pub async fn delete(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<bool, DatabaseError> {
    sqlx::query(
        "DELETE FROM meal_pattern_entries \
         WHERE id = $1 \
           AND day_type_id IN (SELECT id FROM user_day_types WHERE user_id = $2)",
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await
    .map(|r| r.rows_affected() > 0)
    .map_err(DatabaseError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{day_type as dt_db, users};
    use chrono::NaiveTime as T;

    async fn new_user(pool: &PgPool) -> Uuid {
        users::create(
            pool,
            &format!("{}@test.invalid", Uuid::new_v4()),
            None,
            None,
        )
        .await
        .expect("create user")
        .user_id
    }

    async fn new_day_type(pool: &PgPool, user_id: Uuid) -> Uuid {
        dt_db::create(
            pool,
            user_id,
            "Weekdays",
            62, // Mon–Fri bitmask
            T::from_hms_opt(7, 0, 0).unwrap(),
            T::from_hms_opt(22, 0, 0).unwrap(),
            false,
            None,
            None,
            0,
        )
        .await
        .expect("create day type")
        .id
    }

    fn t(hh: u32, mm: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(hh, mm, 0).unwrap()
    }

    // ── list_for_day_type ─────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn list_returns_empty_for_new_day_type(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid).await;
        assert!(list_for_day_type(&pool, dtid).await.unwrap().is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_orders_by_sort_order(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid).await;
        create(&pool, dtid, "Dinner", t(18, 0), 60, 3)
            .await
            .unwrap();
        create(&pool, dtid, "Breakfast", t(8, 0), 60, 1)
            .await
            .unwrap();
        create(&pool, dtid, "Lunch", t(12, 0), 60, 2).await.unwrap();
        let rows = list_for_day_type(&pool, dtid).await.unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["Breakfast", "Lunch", "Dinner"]);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_excludes_other_day_types(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid_a = new_day_type(&pool, uid).await;
        // Non-overlapping bitmask so DB check constraints pass
        let dtid_b = dt_db::create(
            &pool,
            uid,
            "Weekends",
            65,
            NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            NaiveTime::from_hms_opt(23, 0, 0).unwrap(),
            false,
            None,
            None,
            0,
        )
        .await
        .expect("create second day type")
        .id;
        create(&pool, dtid_a, "Breakfast", t(8, 0), 60, 1)
            .await
            .unwrap();
        assert!(list_for_day_type(&pool, dtid_b).await.unwrap().is_empty());
    }

    // ── create ────────────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn create_returns_entry_with_all_fields(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid).await;
        let entry = create(&pool, dtid, "Second Breakfast", t(10, 30), 45, 2)
            .await
            .unwrap();
        assert_eq!(entry.day_type_id, dtid);
        assert_eq!(entry.name, "Second Breakfast");
        assert_eq!(entry.preferred_time, t(10, 30));
        assert_eq!(entry.tolerance_minutes, 45);
        assert_eq!(entry.sort_order, 2);
    }

    // Positive test: same name/sort_order must be ALLOWED across different day types
    #[sqlx::test(migrations = "./migrations")]
    async fn same_name_and_sort_order_allowed_across_day_types(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid_a = new_day_type(&pool, uid).await;
        let dtid_b = dt_db::create(
            &pool,
            uid,
            "Weekends",
            65,
            NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            NaiveTime::from_hms_opt(23, 0, 0).unwrap(),
            false,
            None,
            None,
            0,
        )
        .await
        .expect("create second day type")
        .id;
        create(&pool, dtid_a, "Lunch", t(12, 0), 60, 1)
            .await
            .unwrap();
        create(&pool, dtid_b, "Lunch", t(12, 30), 60, 1)
            .await
            .unwrap(); // must succeed
    }

    // ── get_by_id ─────────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn get_by_id_returns_record(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid).await;
        let created = create(&pool, dtid, "Lunch", t(12, 0), 60, 1).await.unwrap();
        let found = get_by_id(&pool, created.id, uid).await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, created.id);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_by_id_returns_none_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        assert!(
            get_by_id(&pool, Uuid::new_v4(), uid)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_by_id_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let dtid_a = new_day_type(&pool, uid_a).await;
        let entry = create(&pool, dtid_a, "Lunch", t(12, 0), 60, 1)
            .await
            .unwrap();
        // uid_b cannot see uid_a's entry even if they know the UUID
        assert!(get_by_id(&pool, entry.id, uid_b).await.unwrap().is_none());
    }

    // ── update ────────────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn update_changes_fields(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid).await;
        let entry = create(&pool, dtid, "Lunch", t(12, 0), 60, 1).await.unwrap();
        let updated = update(&pool, entry.id, uid, "Brunch", t(11, 0), 30, 1)
            .await
            .unwrap()
            .expect("should return updated");
        assert_eq!(updated.name, "Brunch");
        assert_eq!(updated.preferred_time, t(11, 0));
        assert_eq!(updated.tolerance_minutes, 30);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_returns_none_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        assert!(
            update(&pool, Uuid::new_v4(), uid, "X", t(8, 0), 60, 1)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let dtid_a = new_day_type(&pool, uid_a).await;
        let entry = create(&pool, dtid_a, "Lunch", t(12, 0), 60, 1)
            .await
            .unwrap();
        assert!(
            update(&pool, entry.id, uid_b, "X", t(8, 0), 60, 1)
                .await
                .unwrap()
                .is_none()
        );
    }

    // ── delete ────────────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_true(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid).await;
        let entry = create(&pool, dtid, "Dinner", t(18, 0), 60, 1)
            .await
            .unwrap();
        assert!(delete(&pool, entry.id, uid).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_false_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        assert!(!delete(&pool, Uuid::new_v4(), uid).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let dtid_a = new_day_type(&pool, uid_a).await;
        let entry = create(&pool, dtid_a, "Dinner", t(18, 0), 60, 1)
            .await
            .unwrap();
        assert!(!delete(&pool, entry.id, uid_b).await.unwrap());
        assert_eq!(list_for_day_type(&pool, dtid_a).await.unwrap().len(), 1);
    }

    // ── constraint enforcement ────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn name_unique_constraint_enforced_within_day_type(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid).await;
        create(&pool, dtid, "Lunch", t(12, 0), 60, 1).await.unwrap();
        let result = create(&pool, dtid, "Lunch", t(13, 0), 60, 2).await;
        assert!(result.is_err());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn sort_order_unique_constraint_enforced_within_day_type(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid).await;
        create(&pool, dtid, "Lunch", t(12, 0), 60, 1).await.unwrap();
        let result = create(&pool, dtid, "Dinner", t(18, 0), 60, 1).await;
        assert!(result.is_err());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn tolerance_minutes_check_constraint_enforced(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid).await;
        let result = create(&pool, dtid, "Lunch", t(12, 0), -1, 1).await;
        assert!(result.is_err());
    }
}
