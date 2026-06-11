use chrono::{NaiveDate, NaiveTime};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::{DayType, MealAnchorInstance, MealConsumptionStatus, day_type_applies_to};

const COLUMNS: &str = "id, user_id, date, name, preferred_time, tolerance_minutes, \
     sort_order, template_entry_id, status, consumed_at, created_at, updated_at";

#[tracing::instrument(skip(pool), fields(table = "meal_anchor_instances", op = "get_by_id"))]
pub async fn get_by_id(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<MealAnchorInstance>, DatabaseError> {
    sqlx::query_as::<_, MealAnchorInstance>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM meal_anchor_instances \
         WHERE id = $1 AND user_id = $2"
    )))
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(
    skip(pool),
    fields(table = "meal_anchor_instances", op = "list_for_date")
)]
pub async fn list_for_date(
    pool: &PgPool,
    user_id: Uuid,
    date: NaiveDate,
) -> Result<Vec<MealAnchorInstance>, DatabaseError> {
    sqlx::query_as::<_, MealAnchorInstance>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM meal_anchor_instances \
         WHERE user_id = $1 AND date = $2 \
         ORDER BY preferred_time, sort_order, id"
    )))
    .bind(user_id)
    .bind(date)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(
    skip(pool),
    fields(table = "meal_anchor_instances", op = "list_for_date_range")
)]
pub async fn list_for_date_range(
    pool: &PgPool,
    user_id: Uuid,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<Vec<MealAnchorInstance>, DatabaseError> {
    sqlx::query_as::<_, MealAnchorInstance>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM meal_anchor_instances \
         WHERE user_id = $1 AND date >= $2 AND date <= $3 \
         ORDER BY date, preferred_time, sort_order, id"
    )))
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Idempotent materialization for `(user_id, date)`.
///
/// On first call for a date: picks the active day type via
/// [`day_type_applies_to`], copies that day type's `meal_pattern_entries`
/// into `meal_anchor_instances`, records the materialization marker, and
/// returns the freshly-created instances. On subsequent calls: returns
/// whatever instances currently exist for the date (which may be fewer
/// than the template if the user has removed some, or empty if the user
/// has cleared the date).
#[tracing::instrument(
    skip(pool),
    fields(table = "meal_anchor_instances", op = "materialize")
)]
pub async fn materialize(
    pool: &PgPool,
    user_id: Uuid,
    date: NaiveDate,
) -> Result<Vec<MealAnchorInstance>, DatabaseError> {
    let mut tx = pool.begin().await.map_err(DatabaseError::from)?;

    // Claim the materialization slot. If the row already exists, we did NOT
    // insert and another caller has already materialized this date — fall
    // through to a plain read.
    let claimed: Option<(NaiveDate,)> = sqlx::query_as(
        "INSERT INTO meal_anchor_materializations (user_id, date) \
         VALUES ($1, $2) \
         ON CONFLICT DO NOTHING \
         RETURNING date",
    )
    .bind(user_id)
    .bind(date)
    .fetch_optional(&mut *tx)
    .await
    .map_err(DatabaseError::from)?;

    if claimed.is_some() {
        // Find the active day type for this date.
        let mut day_types: Vec<DayType> = sqlx::query_as::<_, DayType>(
            "SELECT id, user_id, name, days_bitmask, wake_time, sleep_time, \
                    is_cycle, cycle_length, anchor_date, cycle_bitmask, created_at \
             FROM user_day_types WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(DatabaseError::from)?;
        day_types.sort_by_key(|dt| std::cmp::Reverse(dt.created_at));

        if let Some(dt) = day_types.iter().find(|dt| day_type_applies_to(dt, date)) {
            // Copy the template. INSERT ... SELECT keeps the work in-db
            // and inherits the sort_order from the template.
            sqlx::query(
                "INSERT INTO meal_anchor_instances \
                    (user_id, date, name, preferred_time, tolerance_minutes, \
                     sort_order, template_entry_id) \
                 SELECT $1, $2, name, preferred_time, tolerance_minutes, \
                        sort_order, id \
                 FROM meal_pattern_entries \
                 WHERE day_type_id = $3 \
                 ORDER BY sort_order",
            )
            .bind(user_id)
            .bind(date)
            .bind(dt.id)
            .execute(&mut *tx)
            .await
            .map_err(DatabaseError::from)?;
        }
        // If no day type matches, we still mark the date materialized so we
        // don't keep re-checking. The instance set is correctly empty.
    }

    let result = sqlx::query_as::<_, MealAnchorInstance>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM meal_anchor_instances \
         WHERE user_id = $1 AND date = $2 \
         ORDER BY preferred_time, sort_order, id"
    )))
    .bind(user_id)
    .bind(date)
    .fetch_all(&mut *tx)
    .await
    .map_err(DatabaseError::from)?;

    tx.commit().await.map_err(DatabaseError::from)?;
    Ok(result)
}

/// Idempotent batch materialization for all dates in `[start, end]`.
///
/// Equivalent to calling [`materialize`] once per date, but executes in a
/// single transaction and fetches `user_day_types` only once. Dates that are
/// already materialized (marker present in `meal_anchor_materializations`) are
/// skipped automatically via `ON CONFLICT DO NOTHING`. Returns all instances
/// that exist for the range after materialization completes.
#[tracing::instrument(
    skip(pool),
    fields(table = "meal_anchor_instances", op = "materialize_range")
)]
pub async fn materialize_range(
    pool: &PgPool,
    user_id: Uuid,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<Vec<MealAnchorInstance>, DatabaseError> {
    if end < start {
        return Ok(Vec::new());
    }

    // Collect all dates in [start, end].
    let dates: Vec<NaiveDate> =
        std::iter::successors(Some(start), |d| d.succ_opt().filter(|&nd| nd <= end)).collect();

    let mut tx = pool.begin().await.map_err(DatabaseError::from)?;

    // Claim all unclaimed materialization slots in one statement.
    // Already-materialized dates are skipped via ON CONFLICT DO NOTHING.
    // RETURNING gives us exactly the newly-claimed dates.
    let claimed: Vec<NaiveDate> = sqlx::query_scalar(
        "INSERT INTO meal_anchor_materializations (user_id, date) \
         SELECT $1, d FROM UNNEST($2::date[]) AS d \
         ON CONFLICT DO NOTHING \
         RETURNING date",
    )
    .bind(user_id)
    .bind(&dates)
    .fetch_all(&mut *tx)
    .await
    .map_err(DatabaseError::from)?;

    if !claimed.is_empty() {
        // Fetch day types once — shared across all claimed dates.
        let mut day_types: Vec<DayType> = sqlx::query_as::<_, DayType>(
            "SELECT id, user_id, name, days_bitmask, wake_time, sleep_time, \
                    is_cycle, cycle_length, anchor_date, cycle_bitmask, created_at \
             FROM user_day_types WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(DatabaseError::from)?;
        day_types.sort_by_key(|dt| std::cmp::Reverse(dt.created_at));

        // Group claimed dates by their matching day type (pure Rust, no extra DB round-trips).
        // Dates with no matching day type keep their marker but get no instances — correct by design.
        let mut dates_by_day_type: std::collections::HashMap<Uuid, Vec<NaiveDate>> =
            std::collections::HashMap::new();
        for date in &claimed {
            if let Some(dt) = day_types.iter().find(|dt| day_type_applies_to(dt, *date)) {
                dates_by_day_type.entry(dt.id).or_default().push(*date);
            }
        }

        // One INSERT per day-type group — typically 1–2 writes for a full week.
        for (dt_id, dates_for_type) in &dates_by_day_type {
            sqlx::query(
                "INSERT INTO meal_anchor_instances \
                    (user_id, date, name, preferred_time, tolerance_minutes, \
                     sort_order, template_entry_id) \
                 SELECT $1, d.date, mpe.name, mpe.preferred_time, mpe.tolerance_minutes, \
                        mpe.sort_order, mpe.id \
                 FROM UNNEST($2::date[]) AS d(date) \
                 CROSS JOIN meal_pattern_entries mpe \
                 WHERE mpe.day_type_id = $3 \
                 ORDER BY d.date, mpe.sort_order",
            )
            .bind(user_id)
            .bind(dates_for_type)
            .bind(dt_id)
            .execute(&mut *tx)
            .await
            .map_err(DatabaseError::from)?;
        }
    }

    // Return all instances for the range.
    let result = sqlx::query_as::<_, MealAnchorInstance>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM meal_anchor_instances \
         WHERE user_id = $1 AND date >= $2 AND date <= $3 \
         ORDER BY date, preferred_time, sort_order, id"
    )))
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_all(&mut *tx)
    .await
    .map_err(DatabaseError::from)?;

    tx.commit().await.map_err(DatabaseError::from)?;
    Ok(result)
}

#[tracing::instrument(skip(pool), fields(table = "meal_anchor_instances", op = "add"))]
pub async fn add(
    pool: &PgPool,
    user_id: Uuid,
    date: NaiveDate,
    name: &str,
    preferred_time: NaiveTime,
    tolerance_minutes: i32,
) -> Result<MealAnchorInstance, DatabaseError> {
    let mut tx = pool.begin().await.map_err(DatabaseError::from)?;

    // Editing the date is itself a materialization trigger. Marker-only —
    // we don't auto-import the template here; the caller is expressing
    // explicit intent to add a single anchor.
    sqlx::query(
        "INSERT INTO meal_anchor_materializations (user_id, date) \
         VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .bind(date)
    .execute(&mut *tx)
    .await
    .map_err(DatabaseError::from)?;

    // sort_order is purely cosmetic post-materialization (ordering is by
    // preferred_time), but the column is NOT NULL — append at the end.
    let row: MealAnchorInstance =
        sqlx::query_as::<_, MealAnchorInstance>(sqlx::AssertSqlSafe(format!(
            "INSERT INTO meal_anchor_instances \
            (user_id, date, name, preferred_time, tolerance_minutes, sort_order) \
         SELECT $1, $2, $3, $4, $5, COALESCE(MAX(sort_order), -1) + 1 \
           FROM meal_anchor_instances \
           WHERE user_id = $1 AND date = $2 \
         RETURNING {COLUMNS}"
        )))
        .bind(user_id)
        .bind(date)
        .bind(name)
        .bind(preferred_time)
        .bind(tolerance_minutes)
        .fetch_one(&mut *tx)
        .await
        .map_err(DatabaseError::from)?;

    tx.commit().await.map_err(DatabaseError::from)?;
    Ok(row)
}

#[tracing::instrument(skip(pool), fields(table = "meal_anchor_instances", op = "rename"))]
pub async fn rename(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    name: &str,
) -> Result<Option<MealAnchorInstance>, DatabaseError> {
    sqlx::query_as::<_, MealAnchorInstance>(sqlx::AssertSqlSafe(format!(
        "UPDATE meal_anchor_instances \
         SET name = $3, updated_at = NOW() \
         WHERE id = $1 AND user_id = $2 \
         RETURNING {COLUMNS}"
    )))
    .bind(id)
    .bind(user_id)
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "meal_anchor_instances", op = "retime"))]
pub async fn retime(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    preferred_time: NaiveTime,
    tolerance_minutes: i32,
) -> Result<Option<MealAnchorInstance>, DatabaseError> {
    sqlx::query_as::<_, MealAnchorInstance>(sqlx::AssertSqlSafe(format!(
        "UPDATE meal_anchor_instances \
         SET preferred_time = $3, tolerance_minutes = $4, updated_at = NOW() \
         WHERE id = $1 AND user_id = $2 \
         RETURNING {COLUMNS}"
    )))
    .bind(id)
    .bind(user_id)
    .bind(preferred_time)
    .bind(tolerance_minutes)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "meal_anchor_instances", op = "update"))]
pub async fn update(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    name: Option<&str>,
    preferred_time: Option<NaiveTime>,
    tolerance_minutes: Option<i32>,
) -> Result<Option<MealAnchorInstance>, DatabaseError> {
    sqlx::query_as::<_, MealAnchorInstance>(sqlx::AssertSqlSafe(format!(
        "UPDATE meal_anchor_instances \
         SET name = COALESCE($3, name), \
             preferred_time = COALESCE($4, preferred_time), \
             tolerance_minutes = COALESCE($5, tolerance_minutes), \
             updated_at = NOW() \
         WHERE id = $1 AND user_id = $2 \
         RETURNING {COLUMNS}"
    )))
    .bind(id)
    .bind(user_id)
    .bind(name)
    .bind(preferred_time)
    .bind(tolerance_minutes)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Set the consumption status of a single instance.
///
/// `consumed_at` is stamped to `NOW()` when transitioning to `Consumed` and
/// cleared for every other status, which keeps the `consumed_at ⟺ consumed`
/// CHECK constraint satisfied without the caller having to manage the timestamp.
/// Returns `None` if the instance does not exist or belongs to another user.
#[tracing::instrument(skip(pool), fields(table = "meal_anchor_instances", op = "set_status"))]
pub async fn set_status(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    status: MealConsumptionStatus,
) -> Result<Option<MealAnchorInstance>, DatabaseError> {
    sqlx::query_as::<_, MealAnchorInstance>(sqlx::AssertSqlSafe(format!(
        "UPDATE meal_anchor_instances \
         SET status = $3, \
             consumed_at = CASE WHEN $3 = 'consumed' THEN NOW() ELSE NULL END, \
             updated_at = NOW() \
         WHERE id = $1 AND user_id = $2 \
         RETURNING {COLUMNS}"
    )))
    .bind(id)
    .bind(user_id)
    .bind(status.as_str())
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "meal_anchor_instances", op = "remove"))]
pub async fn remove(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<bool, DatabaseError> {
    sqlx::query("DELETE FROM meal_anchor_instances WHERE id = $1 AND user_id = $2")
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
    use crate::db::{day_type as dt_db, meal_pattern as mp_db, users};
    use crate::models::MealConsumptionStatus;
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

    async fn new_day_type(pool: &PgPool, user_id: Uuid, bitmask: i32) -> Uuid {
        dt_db::create(
            pool,
            user_id,
            &format!("DT-{}", Uuid::new_v4()),
            bitmask,
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

    // A Monday so a Mon–Fri day type (bitmask 62) applies.
    fn monday() -> NaiveDate {
        // 2026-05-18 is a Monday.
        NaiveDate::from_ymd_opt(2026, 5, 18).unwrap()
    }

    // ── materialize ────────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn materialize_copies_template_to_instances(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid, 62).await; // Mon–Fri
        mp_db::create(&pool, dtid, "Breakfast", t(8, 0), 60, 0)
            .await
            .unwrap();
        mp_db::create(&pool, dtid, "Lunch", t(12, 0), 30, 1)
            .await
            .unwrap();
        mp_db::create(&pool, dtid, "Dinner", t(18, 0), 90, 2)
            .await
            .unwrap();

        let rows = materialize(&pool, uid, monday()).await.unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["Breakfast", "Lunch", "Dinner"]);
        assert!(rows.iter().all(|r| r.template_entry_id.is_some()));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn materialize_is_idempotent(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid, 62).await;
        mp_db::create(&pool, dtid, "Lunch", t(12, 0), 30, 0)
            .await
            .unwrap();

        let first = materialize(&pool, uid, monday()).await.unwrap();
        let second = materialize(&pool, uid, monday()).await.unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(second.len(), 1);
        assert_eq!(first[0].id, second[0].id);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn materialize_no_matching_day_type_marks_but_empty(pool: PgPool) {
        let uid = new_user(&pool).await;
        // Only a weekend day type (bitmask 65 = Sun+Sat), but query a Monday.
        let dtid = new_day_type(&pool, uid, 65).await;
        mp_db::create(&pool, dtid, "Brunch", t(11, 0), 60, 0)
            .await
            .unwrap();

        let rows = materialize(&pool, uid, monday()).await.unwrap();
        assert!(rows.is_empty(), "no day type matches Monday");

        // Add a pattern entry to a Monday-matching day type AFTER materializing.
        // Idempotency guarantee: the marker prevents a re-import.
        let dtid_mon = new_day_type(&pool, uid, 62).await;
        mp_db::create(&pool, dtid_mon, "Lunch", t(12, 0), 30, 0)
            .await
            .unwrap();
        let rows2 = materialize(&pool, uid, monday()).await.unwrap();
        assert!(
            rows2.is_empty(),
            "marker must prevent re-materialization even if a matching template now exists"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn materialize_after_user_empties_does_not_re_add(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid, 62).await;
        mp_db::create(&pool, dtid, "Lunch", t(12, 0), 30, 0)
            .await
            .unwrap();

        let rows = materialize(&pool, uid, monday()).await.unwrap();
        assert_eq!(rows.len(), 1);
        remove(&pool, rows[0].id, uid).await.unwrap();

        let rows2 = materialize(&pool, uid, monday()).await.unwrap();
        assert!(rows2.is_empty(), "emptied date must stay empty");
    }

    // ── add ────────────────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn add_inserts_instance_and_marker(pool: PgPool) {
        let uid = new_user(&pool).await;
        let date = monday();

        let inst = add(&pool, uid, date, "Snack", t(15, 30), 45).await.unwrap();
        assert_eq!(inst.name, "Snack");
        assert_eq!(inst.preferred_time, t(15, 30));
        assert_eq!(inst.tolerance_minutes, 45);
        assert!(
            inst.template_entry_id.is_none(),
            "user-added has no lineage"
        );

        // Second materialize must respect the marker: no template re-import.
        let dtid = new_day_type(&pool, uid, 62).await;
        mp_db::create(&pool, dtid, "Lunch", t(12, 0), 30, 0)
            .await
            .unwrap();
        let rows = materialize(&pool, uid, date).await.unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["Snack"], "marker from add() blocks template import");
    }

    // ── rename / retime ────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn rename_updates_name_only(pool: PgPool) {
        let uid = new_user(&pool).await;
        let inst = add(&pool, uid, monday(), "Breakfast", t(8, 0), 60)
            .await
            .unwrap();
        let updated = rename(&pool, inst.id, uid, "Brunch")
            .await
            .unwrap()
            .expect("present");
        assert_eq!(updated.name, "Brunch");
        assert_eq!(updated.preferred_time, t(8, 0));
        assert_eq!(updated.tolerance_minutes, 60);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn retime_updates_time_and_tolerance(pool: PgPool) {
        let uid = new_user(&pool).await;
        let inst = add(&pool, uid, monday(), "Lunch", t(12, 0), 30)
            .await
            .unwrap();
        let updated = retime(&pool, inst.id, uid, t(13, 0), 45)
            .await
            .unwrap()
            .expect("present");
        assert_eq!(updated.name, "Lunch");
        assert_eq!(updated.preferred_time, t(13, 0));
        assert_eq!(updated.tolerance_minutes, 45);
    }

    // ── set_status (consumption tracking) ───────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn add_defaults_to_planned_not_consumed(pool: PgPool) {
        let uid = new_user(&pool).await;
        let inst = add(&pool, uid, monday(), "Lunch", t(12, 0), 30)
            .await
            .unwrap();
        assert_eq!(inst.status, "planned");
        assert!(inst.consumed_at.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn set_status_consumed_records_timestamp(pool: PgPool) {
        let uid = new_user(&pool).await;
        let inst = add(&pool, uid, monday(), "Lunch", t(12, 0), 30)
            .await
            .unwrap();

        let consumed = set_status(&pool, inst.id, uid, MealConsumptionStatus::Consumed)
            .await
            .unwrap()
            .expect("present");
        assert_eq!(consumed.status, "consumed");
        assert!(
            consumed.consumed_at.is_some(),
            "consuming a meal must stamp consumed_at"
        );

        // Reverting to planned clears the timestamp (CHECK invariant).
        let reverted = set_status(&pool, inst.id, uid, MealConsumptionStatus::Planned)
            .await
            .unwrap()
            .expect("present");
        assert_eq!(reverted.status, "planned");
        assert!(reverted.consumed_at.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn set_status_skipped_has_no_timestamp(pool: PgPool) {
        let uid = new_user(&pool).await;
        let inst = add(&pool, uid, monday(), "Lunch", t(12, 0), 30)
            .await
            .unwrap();
        let skipped = set_status(&pool, inst.id, uid, MealConsumptionStatus::Skipped)
            .await
            .unwrap()
            .expect("present");
        assert_eq!(skipped.status, "skipped");
        assert!(skipped.consumed_at.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn set_status_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let inst = add(&pool, uid_a, monday(), "Lunch", t(12, 0), 30)
            .await
            .unwrap();
        assert!(
            set_status(&pool, inst.id, uid_b, MealConsumptionStatus::Consumed)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn rename_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let inst = add(&pool, uid_a, monday(), "Lunch", t(12, 0), 30)
            .await
            .unwrap();
        assert!(rename(&pool, inst.id, uid_b, "X").await.unwrap().is_none());
    }

    // ── remove + cascade ───────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn remove_cascades_to_planned_meal_entry(pool: PgPool) {
        let uid = new_user(&pool).await;
        let inst = add(&pool, uid, monday(), "Lunch", t(12, 0), 30)
            .await
            .unwrap();

        // Attach a planned meal directly via SQL (no repo method available yet
        // for this shape; this exercises the FK cascade specifically).
        let pme_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO planned_meal_entries \
                (meal_entry_id, user_id, meal_anchor_instance_id, meal_ref_id, meal_ref_type, title) \
             VALUES ($1, $2, $3, $4, 'catalog_dish', 'Pad thai')",
        )
        .bind(pme_id)
        .bind(uid)
        .bind(inst.id)
        .bind(Uuid::new_v4())
        .execute(&pool)
        .await
        .unwrap();

        assert!(remove(&pool, inst.id, uid).await.unwrap());

        let row: Option<(Uuid,)> = sqlx::query_as(
            "SELECT meal_entry_id FROM planned_meal_entries WHERE meal_entry_id = $1",
        )
        .bind(pme_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert!(row.is_none(), "FK cascade must delete the planned meal row");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn remove_returns_false_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        assert!(!remove(&pool, Uuid::new_v4(), uid).await.unwrap());
    }

    // ── materialize_range ──────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn materialize_range_empty_when_start_after_end(pool: PgPool) {
        let uid = new_user(&pool).await;
        let d = monday();
        let rows = materialize_range(&pool, uid, d, d.pred_opt().unwrap())
            .await
            .unwrap();
        assert!(rows.is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn materialize_range_copies_template_across_dates(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid, 62).await; // Mon–Fri
        mp_db::create(&pool, dtid, "Breakfast", t(8, 0), 60, 0)
            .await
            .unwrap();
        mp_db::create(&pool, dtid, "Lunch", t(12, 0), 30, 1)
            .await
            .unwrap();

        // Mon 2026-05-18 through Wed 2026-05-20 — all three are weekdays.
        let start = NaiveDate::from_ymd_opt(2026, 5, 18).unwrap();
        let end = NaiveDate::from_ymd_opt(2026, 5, 20).unwrap();
        let rows = materialize_range(&pool, uid, start, end).await.unwrap();

        // 3 dates × 2 meals = 6 instances, ordered by date then time.
        assert_eq!(rows.len(), 6);
        let dates: Vec<NaiveDate> = rows.iter().map(|r| r.date).collect();
        assert_eq!(
            dates,
            [
                start,
                start,
                end.pred_opt().unwrap(),
                end.pred_opt().unwrap(),
                end,
                end
            ]
        );
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Breakfast",
                "Lunch",
                "Breakfast",
                "Lunch",
                "Breakfast",
                "Lunch"
            ]
        );
        assert!(rows.iter().all(|r| r.template_entry_id.is_some()));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn materialize_range_is_idempotent(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid, 62).await;
        mp_db::create(&pool, dtid, "Lunch", t(12, 0), 30, 0)
            .await
            .unwrap();

        let start = NaiveDate::from_ymd_opt(2026, 5, 18).unwrap();
        let end = NaiveDate::from_ymd_opt(2026, 5, 19).unwrap();
        let first = materialize_range(&pool, uid, start, end).await.unwrap();
        let second = materialize_range(&pool, uid, start, end).await.unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(second.len(), 2);
        // Same IDs — no duplicates created.
        let ids_first: Vec<_> = first.iter().map(|r| r.id).collect();
        let ids_second: Vec<_> = second.iter().map(|r| r.id).collect();
        assert_eq!(ids_first, ids_second);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn materialize_range_skips_already_materialized_dates(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dtid = new_day_type(&pool, uid, 62).await;
        mp_db::create(&pool, dtid, "Lunch", t(12, 0), 30, 0)
            .await
            .unwrap();

        let d1 = NaiveDate::from_ymd_opt(2026, 5, 18).unwrap(); // Mon
        let d2 = NaiveDate::from_ymd_opt(2026, 5, 19).unwrap(); // Tue

        // Pre-materialize d1 individually.
        let first = materialize(&pool, uid, d1).await.unwrap();
        assert_eq!(first.len(), 1);

        // Now range-materialize [d1, d2]. d1 must not gain a duplicate.
        let rows = materialize_range(&pool, uid, d1, d2).await.unwrap();
        assert_eq!(rows.len(), 2);
        // d1's instance ID must be the same as the individually-created one.
        let d1_row = rows.iter().find(|r| r.date == d1).unwrap();
        assert_eq!(d1_row.id, first[0].id);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn materialize_range_groups_by_day_type(pool: PgPool) {
        let uid = new_user(&pool).await;
        // Weekday (Mon–Fri, bitmask 62) and weekend (Sat+Sun, bitmask 65).
        let dt_week = new_day_type(&pool, uid, 62).await;
        let dt_wknd = new_day_type(&pool, uid, 65).await;
        mp_db::create(&pool, dt_week, "Lunch", t(12, 0), 30, 0)
            .await
            .unwrap();
        mp_db::create(&pool, dt_wknd, "Brunch", t(11, 0), 60, 0)
            .await
            .unwrap();

        // Full week: Mon 2026-05-18 through Sun 2026-05-24.
        let start = NaiveDate::from_ymd_opt(2026, 5, 18).unwrap();
        let end = NaiveDate::from_ymd_opt(2026, 5, 24).unwrap();
        let rows = materialize_range(&pool, uid, start, end).await.unwrap();

        // 5 weekdays × "Lunch" + 2 weekend days × "Brunch" = 7 instances.
        assert_eq!(rows.len(), 7);
        let weekday_names: Vec<&str> = rows
            .iter()
            .filter(|r| {
                use chrono::Datelike;
                let wd = r.date.weekday();
                wd != chrono::Weekday::Sat && wd != chrono::Weekday::Sun
            })
            .map(|r| r.name.as_str())
            .collect();
        assert!(weekday_names.iter().all(|&n| n == "Lunch"));

        let weekend_names: Vec<&str> = rows
            .iter()
            .filter(|r| {
                use chrono::Datelike;
                let wd = r.date.weekday();
                wd == chrono::Weekday::Sat || wd == chrono::Weekday::Sun
            })
            .map(|r| r.name.as_str())
            .collect();
        assert!(weekend_names.iter().all(|&n| n == "Brunch"));
    }

    // ── list_for_date / list_for_date_range ────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn list_for_date_orders_by_preferred_time(pool: PgPool) {
        let uid = new_user(&pool).await;
        let d = monday();
        add(&pool, uid, d, "Dinner", t(18, 0), 60).await.unwrap();
        add(&pool, uid, d, "Breakfast", t(8, 0), 60).await.unwrap();
        add(&pool, uid, d, "Lunch", t(12, 0), 60).await.unwrap();
        let names: Vec<String> = list_for_date(&pool, uid, d)
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.name)
            .collect();
        assert_eq!(names, ["Breakfast", "Lunch", "Dinner"]);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_for_date_range_filters_dates(pool: PgPool) {
        let uid = new_user(&pool).await;
        let d1 = NaiveDate::from_ymd_opt(2026, 5, 18).unwrap();
        let d2 = NaiveDate::from_ymd_opt(2026, 5, 19).unwrap();
        let d3 = NaiveDate::from_ymd_opt(2026, 5, 20).unwrap();
        add(&pool, uid, d1, "A", t(8, 0), 30).await.unwrap();
        add(&pool, uid, d2, "B", t(8, 0), 30).await.unwrap();
        add(&pool, uid, d3, "C", t(8, 0), 30).await.unwrap();
        let rows = list_for_date_range(&pool, uid, d1, d2).await.unwrap();
        assert_eq!(rows.len(), 2);
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["A", "B"]);
    }
}
