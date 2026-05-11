use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::{
    CarryoverDecision, CommitPlanInput, DayType, MealPatternEntry, OpenSlot, ScheduleEntry,
    day_type_applies_to,
};
use crate::query_types::{PlanStatusResponse, PostSchedulePlanResponse, SchedulePeriodResponse};

const ENTRY_COLS: &str =
    "entry_id, user_id, routine_id, task_type, task_ref_id, task_ref_type, title,
     date, scheduled_start, scheduled_end, status, actual_start, actual_end,
     after_anchor, slot_anchor_id, deviation_note,
     duration_minutes, energy_required, one_shot, created_at, updated_at";

#[tracing::instrument(skip(pool), fields(table = "schedule_entries", op = "get_period"))]
pub async fn get_period(
    pool: &PgPool,
    user_id: Uuid,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<SchedulePeriodResponse, DatabaseError> {
    let entries: Vec<ScheduleEntry> = sqlx::query_as::<_, ScheduleEntry>(&format!(
        "SELECT {ENTRY_COLS} FROM schedule_entries
         WHERE user_id = $1 AND date >= $2 AND date <= $3
         ORDER BY date, scheduled_start"
    ))
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)?;

    let carryover = get_carryover(pool, user_id, start).await?;

    Ok(SchedulePeriodResponse { entries, carryover })
}

#[tracing::instrument(skip(pool), fields(table = "schedule_entries", op = "get_carryover"))]
pub async fn get_carryover(
    pool: &PgPool,
    user_id: Uuid,
    before: NaiveDate,
) -> Result<Vec<ScheduleEntry>, DatabaseError> {
    sqlx::query_as::<_, ScheduleEntry>(&format!(
        "SELECT {ENTRY_COLS} FROM schedule_entries
         WHERE user_id = $1 AND date < $2
           AND status IN ('planned', 'deferred')
           AND one_shot = FALSE
         ORDER BY date, scheduled_start"
    ))
    .bind(user_id)
    .bind(before)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "schedule_entries", op = "get_plan_status"))]
pub async fn get_plan_status(
    pool: &PgPool,
    user_id: Uuid,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<PlanStatusResponse, DatabaseError> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM schedule_entries
         WHERE user_id = $1 AND date >= $2 AND date <= $3
           AND status IN ('planned', 'in_progress', 'completed')",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)?;

    Ok(PlanStatusResponse {
        planned: row.0 > 0,
        entry_count: row.0,
    })
}

#[tracing::instrument(
    skip(pool),
    fields(table = "schedule_entries", op = "update_entry_status")
)]
pub async fn update_entry_status(
    pool: &PgPool,
    user_id: Uuid,
    entry_id: Uuid,
    status: &str,
) -> Result<(), DatabaseError> {
    let result = sqlx::query(
        "UPDATE schedule_entries SET status = $1, updated_at = NOW()
         WHERE entry_id = $2 AND user_id = $3",
    )
    .bind(status)
    .bind(entry_id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(DatabaseError::from)?;

    if result.rows_affected() == 0 {
        return Err(DatabaseError::NotFound);
    }
    Ok(())
}

#[tracing::instrument(
    skip(pool, req),
    fields(table = "schedule_entries", op = "commit_plan")
)]
pub async fn commit_plan(
    pool: &PgPool,
    user_id: Uuid,
    req: &CommitPlanInput,
) -> Result<PostSchedulePlanResponse, DatabaseError> {
    let today = chrono::Utc::now().date_naive();

    let mut tx = pool.begin().await.map_err(DatabaseError::from)?;

    // Window-close drop pass (§4.10): one-shot tasks left incomplete before the
    // new plan window are silently marked skipped and never surface in carryover.
    sqlx::query(
        "UPDATE schedule_entries
         SET status = 'skipped', updated_at = NOW()
         WHERE user_id = $1
           AND date < $2
           AND one_shot = TRUE
           AND status IN ('planned', 'deferred')",
    )
    .bind(user_id)
    .bind(req.plan_start)
    .execute(&mut *tx)
    .await
    .map_err(DatabaseError::from)?;

    // If replace=true, delete planned entries for unstarted days only (spec §303).
    // An unstarted day has no in_progress or completed entries; started days are
    // left completely untouched even if replace=true.
    if req.replace {
        let started_days: Vec<NaiveDate> = sqlx::query_scalar(
            "SELECT DISTINCT date FROM schedule_entries
             WHERE user_id = $1 AND date >= $2 AND date <= $3
               AND status IN ('in_progress', 'completed')",
        )
        .bind(user_id)
        .bind(req.plan_start)
        .bind(req.plan_end)
        .fetch_all(&mut *tx)
        .await
        .map_err(DatabaseError::from)?;

        sqlx::query(
            "DELETE FROM schedule_entries
             WHERE user_id = $1
               AND date >= GREATEST($2, $3)
               AND date <= $4
               AND status = 'planned'
               AND date != ALL($5)",
        )
        .bind(user_id)
        .bind(today)
        .bind(req.plan_start)
        .bind(req.plan_end)
        .bind(&started_days)
        .execute(&mut *tx)
        .await
        .map_err(DatabaseError::from)?;
    }

    // Collect and batch-insert all new entries in a single unnest query
    let mut task_types: Vec<Option<String>> = Vec::new();
    let mut task_ref_ids: Vec<Option<Uuid>> = Vec::new();
    let mut task_ref_types: Vec<Option<String>> = Vec::new();
    let mut titles: Vec<Option<String>> = Vec::new();
    let mut dates: Vec<NaiveDate> = Vec::new();
    let mut scheduled_starts: Vec<Option<DateTime<Utc>>> = Vec::new();
    let mut after_anchors: Vec<Option<String>> = Vec::new();
    let mut duration_minutes_vals: Vec<Option<i32>> = Vec::new();
    let mut energy_required_vals: Vec<Option<String>> = Vec::new();
    let mut one_shot_vals: Vec<bool> = Vec::new();

    for entry in &req.entries {
        let scheduled_start = entry
            .scheduled_start
            .map(|t| entry.date.and_time(t).and_utc());
        task_types.push(entry.task_type.clone());
        task_ref_ids.push(entry.task_ref_id);
        task_ref_types.push(entry.task_ref_type.clone());
        titles.push(entry.title.clone());
        dates.push(entry.date);
        scheduled_starts.push(scheduled_start);
        after_anchors.push(entry.after_anchor.clone());
        duration_minutes_vals.push(entry.duration_minutes);
        energy_required_vals.push(entry.energy_required.clone());
        one_shot_vals.push(entry.one_shot.unwrap_or(false));
    }

    let committed = task_types.len() as i64;

    if !task_types.is_empty() {
        sqlx::query(
            "INSERT INTO schedule_entries
               (user_id, task_type, task_ref_id, task_ref_type, title,
                date, scheduled_start, status, after_anchor,
                duration_minutes, energy_required, one_shot)
             SELECT $1, unnest($2::text[]), unnest($3::uuid[]), unnest($4::text[]),
                    unnest($5::text[]), unnest($6::date[]), unnest($7::timestamptz[]),
                    'planned', unnest($8::text[]),
                    unnest($9::int4[]), unnest($10::text[]), unnest($11::bool[])",
        )
        .bind(user_id)
        .bind(&task_types)
        .bind(&task_ref_ids)
        .bind(&task_ref_types)
        .bind(&titles)
        .bind(&dates)
        .bind(&scheduled_starts)
        .bind(&after_anchors)
        .bind(&duration_minutes_vals)
        .bind(&energy_required_vals)
        .bind(&one_shot_vals)
        .execute(&mut *tx)
        .await
        .map_err(DatabaseError::from)?;
    }

    // Mark planning task as completed
    sqlx::query(
        "UPDATE tasks SET status = 'completed', updated_at = NOW()
         WHERE task_id = $1 AND user_id = $2",
    )
    .bind(req.planning_task_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(DatabaseError::from)?;

    // Apply carryover decisions: update carry-over entries
    for (entry_id, decision) in &req.carryover_decisions {
        match decision {
            CarryoverDecision::Carry => {
                // Reschedule to the new horizon start, keeping status 'planned'.
                // Update both `date` and `scheduled_start` so the absolute TIMESTAMPTZ
                // moves to the new date while preserving the wall-clock time (UTC).
                sqlx::query(
                    "UPDATE schedule_entries
                     SET date = $1,
                         scheduled_start = ($1 + (scheduled_start AT TIME ZONE 'UTC')::time) AT TIME ZONE 'UTC',
                         updated_at = NOW()
                     WHERE entry_id = $2 AND user_id = $3",
                )
                .bind(req.plan_start)
                .bind(entry_id)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(DatabaseError::from)?;
            }
            CarryoverDecision::Defer => {
                sqlx::query(
                    "UPDATE schedule_entries SET status = 'deferred', updated_at = NOW()
                     WHERE entry_id = $1 AND user_id = $2",
                )
                .bind(entry_id)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(DatabaseError::from)?;
            }
            CarryoverDecision::Drop => {
                let reason = req
                    .drop_reasons
                    .get(entry_id)
                    .map(String::as_str)
                    .unwrap_or("");
                sqlx::query(
                    "UPDATE schedule_entries
                     SET status = 'skipped', deviation_note = NULLIF($3, ''), updated_at = NOW()
                     WHERE entry_id = $1 AND user_id = $2",
                )
                .bind(entry_id)
                .bind(user_id)
                .bind(reason)
                .execute(&mut *tx)
                .await
                .map_err(DatabaseError::from)?;
            }
        }
    }

    tx.commit().await.map_err(DatabaseError::from)?;

    Ok(PostSchedulePlanResponse {
        committed,
        planning_task_status: "completed".to_string(),
    })
}

/// Returns the meal slots that are still open for `[plan_start, plan_end]`.
///
/// For each date the active day type is determined (most-recently-created first;
/// first match wins) and its pattern entries are collected. Slots present in
/// `locked` — a list of `(date, meal_name)` pairs representing approved,
/// skipped, and custom meals — are subtracted before returning.
#[tracing::instrument(
    skip(pool, locked),
    fields(table = "meal_pattern_entries", op = "resolve_open_slots")
)]
pub async fn resolve_open_slots(
    pool: &PgPool,
    user_id: Uuid,
    plan_start: NaiveDate,
    plan_end: NaiveDate,
    locked: &[(NaiveDate, String)],
) -> Result<Vec<OpenSlot>, DatabaseError> {
    let mut day_types: Vec<DayType> = sqlx::query_as::<_, DayType>(
        "SELECT id, user_id, name, days_bitmask, wake_time, sleep_time, \
                is_cycle, cycle_length, anchor_date, cycle_bitmask, created_at \
         FROM user_day_types WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)?;

    day_types.sort_by_key(|dt| std::cmp::Reverse(dt.created_at));

    if day_types.is_empty() || plan_end < plan_start {
        return Ok(Vec::new());
    }

    let day_type_ids: Vec<Uuid> = day_types.iter().map(|dt| dt.id).collect();
    let meal_entries: Vec<MealPatternEntry> = sqlx::query_as::<_, MealPatternEntry>(
        "SELECT id, day_type_id, name, preferred_time, tolerance_minutes, sort_order, created_at \
         FROM meal_pattern_entries \
         WHERE day_type_id = ANY($1) \
         ORDER BY day_type_id, sort_order",
    )
    .bind(&day_type_ids)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)?;

    let mut meals_by_day_type: HashMap<Uuid, Vec<String>> = HashMap::new();
    for entry in meal_entries {
        meals_by_day_type
            .entry(entry.day_type_id)
            .or_default()
            .push(entry.name);
    }

    let locked_set: HashSet<(NaiveDate, &str)> =
        locked.iter().map(|(d, n)| (*d, n.as_str())).collect();

    let mut result = Vec::new();
    let mut date = plan_start;
    while date <= plan_end {
        if let Some(dt) = day_types.iter().find(|dt| day_type_applies_to(dt, date))
            && let Some(meal_names) = meals_by_day_type.get(&dt.id)
        {
            for meal_name in meal_names {
                if !locked_set.contains(&(date, meal_name.as_str())) {
                    result.push(OpenSlot {
                        date,
                        meal_name: meal_name.clone(),
                    });
                }
            }
        }
        let Some(next) = date.succ_opt() else { break };
        date = next;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, Utc};
    use sqlx::PgPool;
    use uuid::Uuid;

    use super::*;
    use crate::db::{tasks, users};
    use crate::models::PlanEntryInput;

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

    async fn make_planning_task(pool: &PgPool, user_id: Uuid, plan_start: NaiveDate) -> Uuid {
        tasks::create_weekly_plan_task(pool, user_id, plan_start, 0)
            .await
            .expect("failed to create planning task")
            .task_id
    }

    fn tomorrow() -> NaiveDate {
        Utc::now().date_naive() + Duration::days(1)
    }

    fn work_entry(date: NaiveDate) -> PlanEntryInput {
        PlanEntryInput {
            date,
            task_type: Some("work".to_string()),
            task_ref_id: None,
            task_ref_type: None,
            title: Some("Test task".to_string()),
            scheduled_start: Some(NaiveTime::from_hms_opt(9, 0, 0).unwrap()),
            after_anchor: None,
            duration_minutes: None,
            energy_required: None,
            one_shot: None,
        }
    }

    // -----------------------------------------------------------------------
    // get_period
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn get_period_returns_empty_for_new_user(pool: PgPool) {
        let uid = new_user(&pool).await;
        let start = tomorrow();
        let end = start + Duration::days(7);

        let result = get_period(&pool, uid, start, end).await.unwrap();

        assert!(result.entries.is_empty());
        assert!(result.carryover.is_empty());
    }

    // -----------------------------------------------------------------------
    // get_plan_status
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn get_plan_status_unplanned_for_new_user(pool: PgPool) {
        let uid = new_user(&pool).await;
        let start = tomorrow();
        let end = start + Duration::days(7);

        let result = get_plan_status(&pool, uid, start, end).await.unwrap();

        assert!(!result.planned);
        assert_eq!(result.entry_count, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_plan_status_reflects_committed_entries(pool: PgPool) {
        let uid = new_user(&pool).await;
        let start = tomorrow();
        let end = start + Duration::days(6);
        let task_id = make_planning_task(&pool, uid, start).await;

        let req = CommitPlanInput {
            plan_start: start,
            plan_end: end,
            planning_task_id: task_id,
            entries: vec![work_entry(start), work_entry(start + Duration::days(1))],
            replace: false,
            carryover_decisions: HashMap::new(),
            drop_reasons: HashMap::new(),
        };
        commit_plan(&pool, uid, &req).await.unwrap();

        let status = get_plan_status(&pool, uid, start, end).await.unwrap();
        assert!(status.planned);
        assert_eq!(status.entry_count, 2);
    }

    // -----------------------------------------------------------------------
    // commit_plan
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn commit_plan_inserts_schedule_entries(pool: PgPool) {
        let uid = new_user(&pool).await;
        let start = tomorrow();
        let end = start + Duration::days(6);
        let task_id = make_planning_task(&pool, uid, start).await;

        let req = CommitPlanInput {
            plan_start: start,
            plan_end: end,
            planning_task_id: task_id,
            entries: vec![
                work_entry(start),
                work_entry(start + Duration::days(1)),
                work_entry(start + Duration::days(2)),
            ],
            replace: false,
            carryover_decisions: HashMap::new(),
            drop_reasons: HashMap::new(),
        };

        let resp = commit_plan(&pool, uid, &req).await.unwrap();
        assert_eq!(resp.committed, 3);
        assert_eq!(resp.planning_task_status, "completed");

        let period = get_period(&pool, uid, start, end).await.unwrap();
        assert_eq!(period.entries.len(), 3);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn commit_plan_handles_carryover_decisions(pool: PgPool) {
        let uid = new_user(&pool).await;
        let today = Utc::now().date_naive();
        let plan_start = today + Duration::days(1);
        let plan_end = plan_start + Duration::days(6);

        // Raw-insert 3 carryover entries dated before plan_start — no horizon applies
        let carryover_date = today - Duration::days(1);
        let sched = (carryover_date.and_hms_opt(9, 0, 0).unwrap()).and_utc();

        let id_carry: Uuid = sqlx::query_scalar(
            "INSERT INTO schedule_entries (user_id, task_type, title, date, scheduled_start, status)
             VALUES ($1, 'work', 'carry-me', $2, $3, 'planned') RETURNING entry_id",
        )
        .bind(uid)
        .bind(carryover_date)
        .bind(sched)
        .fetch_one(&pool)
        .await
        .unwrap();

        let id_defer: Uuid = sqlx::query_scalar(
            "INSERT INTO schedule_entries (user_id, task_type, title, date, scheduled_start, status)
             VALUES ($1, 'work', 'defer-me', $2, $3, 'planned') RETURNING entry_id",
        )
        .bind(uid)
        .bind(carryover_date)
        .bind(sched)
        .fetch_one(&pool)
        .await
        .unwrap();

        let id_drop: Uuid = sqlx::query_scalar(
            "INSERT INTO schedule_entries (user_id, task_type, title, date, scheduled_start, status)
             VALUES ($1, 'work', 'drop-me', $2, $3, 'planned') RETURNING entry_id",
        )
        .bind(uid)
        .bind(carryover_date)
        .bind(sched)
        .fetch_one(&pool)
        .await
        .unwrap();

        let task_id = make_planning_task(&pool, uid, plan_start).await;
        let mut decisions = HashMap::new();
        decisions.insert(id_carry, CarryoverDecision::Carry);
        decisions.insert(id_defer, CarryoverDecision::Defer);
        decisions.insert(id_drop, CarryoverDecision::Drop);

        let req = CommitPlanInput {
            plan_start,
            plan_end,
            planning_task_id: task_id,
            entries: vec![],
            replace: false,
            carryover_decisions: decisions,
            drop_reasons: HashMap::new(),
        };
        commit_plan(&pool, uid, &req).await.unwrap();

        let (date_a, status_a, sched_a): (NaiveDate, String, Option<DateTime<Utc>>) =
            sqlx::query_as(
                "SELECT date, status, scheduled_start FROM schedule_entries WHERE entry_id = $1",
            )
            .bind(id_carry)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(date_a, plan_start, "Carry should reschedule to plan_start");
        assert_eq!(status_a, "planned");
        assert_eq!(
            sched_a.unwrap().time(),
            NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            "Time must be preserved"
        );

        let status_d: String =
            sqlx::query_scalar("SELECT status FROM schedule_entries WHERE entry_id = $1")
                .bind(id_defer)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status_d, "deferred");

        let status_x: String =
            sqlx::query_scalar("SELECT status FROM schedule_entries WHERE entry_id = $1")
                .bind(id_drop)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status_x, "skipped");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn commit_plan_is_atomic(pool: PgPool) {
        let uid = new_user(&pool).await;
        let start = tomorrow();
        let end = start + Duration::days(6);

        // First commit: establish 2 planned entries
        let task_id_1 = make_planning_task(&pool, uid, start).await;
        let initial_req = CommitPlanInput {
            plan_start: start,
            plan_end: end,
            planning_task_id: task_id_1,
            entries: vec![work_entry(start), work_entry(start + Duration::days(1))],
            replace: false,
            carryover_decisions: HashMap::new(),
            drop_reasons: HashMap::new(),
        };
        commit_plan(&pool, uid, &initial_req).await.unwrap();

        // Second commit with replace=true but an invalid task_type that violates the DB CHECK.
        // The DELETE will run first, then the INSERT should fail, rolling back the whole tx.
        let task_id_2 = make_planning_task(&pool, uid, start + Duration::days(7)).await;
        let bad_entry = PlanEntryInput {
            date: start,
            task_type: Some("invalid_type".to_string()), // violates CHECK constraint
            task_ref_id: None,
            task_ref_type: None,
            title: None,
            scheduled_start: Some(NaiveTime::from_hms_opt(10, 0, 0).unwrap()),
            after_anchor: None,
            duration_minutes: None,
            energy_required: None,
            one_shot: None,
        };
        let bad_req = CommitPlanInput {
            plan_start: start,
            plan_end: end,
            planning_task_id: task_id_2,
            entries: vec![bad_entry],
            replace: true,
            carryover_decisions: HashMap::new(),
            drop_reasons: HashMap::new(),
        };

        let result = commit_plan(&pool, uid, &bad_req).await;
        assert!(result.is_err(), "expected error from CHECK violation");

        // Original 2 entries must still be there — the DELETE was rolled back
        let period = get_period(&pool, uid, start, end).await.unwrap();
        assert_eq!(
            period.entries.len(),
            2,
            "transaction rollback must preserve original entries"
        );

        let task_2_status: String =
            sqlx::query_scalar("SELECT status FROM tasks WHERE task_id = $1")
                .bind(task_id_2)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            task_2_status, "planned",
            "planning task status must also be rolled back"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn commit_plan_supports_bucket_task_with_null_scheduled_start(pool: PgPool) {
        let uid = new_user(&pool).await;
        let start = tomorrow();
        let end = start + Duration::days(6);
        let task_id = make_planning_task(&pool, uid, start).await;

        let bucket_entry = PlanEntryInput {
            date: start,
            task_type: Some("work".to_string()),
            task_ref_id: None,
            task_ref_type: None,
            title: Some("Bucket task".to_string()),
            scheduled_start: None,
            after_anchor: Some("lunch".to_string()),
            duration_minutes: None,
            energy_required: None,
            one_shot: None,
        };

        let req = CommitPlanInput {
            plan_start: start,
            plan_end: end,
            planning_task_id: task_id,
            entries: vec![bucket_entry],
            replace: false,
            carryover_decisions: HashMap::new(),
            drop_reasons: HashMap::new(),
        };

        commit_plan(&pool, uid, &req).await.unwrap();

        let period = get_period(&pool, uid, start, end).await.unwrap();
        assert_eq!(period.entries.len(), 1);
        assert!(
            period.entries[0].scheduled_start.is_none(),
            "bucket task should have no scheduled_start"
        );
        assert_eq!(
            period.entries[0].after_anchor,
            Some("lunch".to_string()),
            "after_anchor must be preserved"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn commit_plan_persists_duration_and_energy(pool: PgPool) {
        let uid = new_user(&pool).await;
        let start = tomorrow();
        let end = start + Duration::days(6);
        let task_id = make_planning_task(&pool, uid, start).await;

        let entry = PlanEntryInput {
            date: start,
            task_type: Some("work".to_string()),
            task_ref_id: None,
            task_ref_type: None,
            title: Some("Timed task".to_string()),
            scheduled_start: Some(NaiveTime::from_hms_opt(10, 0, 0).unwrap()),
            after_anchor: None,
            duration_minutes: Some(45),
            energy_required: Some("medium".to_string()),
            one_shot: None,
        };

        let req = CommitPlanInput {
            plan_start: start,
            plan_end: end,
            planning_task_id: task_id,
            entries: vec![entry],
            replace: false,
            carryover_decisions: HashMap::new(),
            drop_reasons: HashMap::new(),
        };

        commit_plan(&pool, uid, &req).await.unwrap();

        let period = get_period(&pool, uid, start, end).await.unwrap();
        assert_eq!(period.entries.len(), 1);
        assert_eq!(
            period.entries[0].duration_minutes,
            Some(45),
            "duration_minutes must roundtrip through commit_plan"
        );
        assert_eq!(
            period.entries[0].energy_required.as_deref(),
            Some("medium"),
            "energy_required must roundtrip through commit_plan"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn commit_plan_with_meal_anchor_inserts_correctly(pool: PgPool) {
        let uid = new_user(&pool).await;
        let start = tomorrow();
        let end = start + Duration::days(6);
        let task_id = make_planning_task(&pool, uid, start).await;

        // Meal anchor entry: task_type = None (distinct from task entries)
        let meal_entry = PlanEntryInput {
            date: start,
            task_type: None,
            task_ref_id: None,
            task_ref_type: None,
            title: Some("Oatmeal".to_string()),
            scheduled_start: None,
            after_anchor: Some("breakfast".to_string()),
            duration_minutes: None,
            energy_required: None,
            one_shot: None,
        };

        let req = CommitPlanInput {
            plan_start: start,
            plan_end: end,
            planning_task_id: task_id,
            entries: vec![meal_entry],
            replace: false,
            carryover_decisions: HashMap::new(),
            drop_reasons: HashMap::new(),
        };

        commit_plan(&pool, uid, &req).await.unwrap();

        let period = get_period(&pool, uid, start, end).await.unwrap();
        assert_eq!(period.entries.len(), 1);
        let e = &period.entries[0];
        assert_eq!(e.task_type, None, "meal anchor has no task_type");
        assert_eq!(e.title.as_deref(), Some("Oatmeal"), "title must roundtrip");
        assert_eq!(
            e.after_anchor.as_deref(),
            Some("breakfast"),
            "after_anchor must roundtrip"
        );
        assert!(
            e.scheduled_start.is_none(),
            "meal anchor has no scheduled_start"
        );
    }

    // -----------------------------------------------------------------------
    // get_period — no-horizon carryover
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn test_get_period_surfaces_carryover_regardless_of_age(pool: PgPool) {
        let uid = new_user(&pool).await;
        let plan_start = tomorrow();
        let plan_end = plan_start + Duration::days(6);

        // Raw-insert an entry dated 200 days before plan_start — well beyond any
        // former 90-day lookback cap.
        let old_date = plan_start - Duration::days(200);
        let old_sched = old_date.and_hms_opt(9, 0, 0).unwrap().and_utc();

        sqlx::query(
            "INSERT INTO schedule_entries (user_id, task_type, title, date, scheduled_start, status)
             VALUES ($1, 'work', 'ancient-planned', $2, $3, 'planned')",
        )
        .bind(uid)
        .bind(old_date)
        .bind(old_sched)
        .execute(&pool)
        .await
        .unwrap();

        let period = get_period(&pool, uid, plan_start, plan_end).await.unwrap();

        assert_eq!(
            period.carryover.len(),
            1,
            "entry 200 days old must appear in carryover — no date floor is applied"
        );
        assert_eq!(
            period.carryover[0].title.as_deref(),
            Some("ancient-planned"),
        );
    }

    // -----------------------------------------------------------------------
    // H.5 — get_carryover excludes one-shot entries
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn get_carryover_excludes_one_shot_entries(pool: PgPool) {
        let uid = new_user(&pool).await;
        let plan_start = tomorrow();

        let old_date = plan_start - Duration::days(1);
        let sched = old_date.and_hms_opt(9, 0, 0).unwrap().and_utc();

        // Regular entry — should appear in carryover
        sqlx::query(
            "INSERT INTO schedule_entries
               (user_id, task_type, title, date, scheduled_start, status, one_shot)
             VALUES ($1, 'work', 'carry-me', $2, $3, 'planned', FALSE)",
        )
        .bind(uid)
        .bind(old_date)
        .bind(sched)
        .execute(&pool)
        .await
        .unwrap();

        // One-shot entry — must be excluded from carryover
        sqlx::query(
            "INSERT INTO schedule_entries
               (user_id, task_type, title, date, scheduled_start, status, one_shot)
             VALUES ($1, 'general', 'drop-me', $2, $3, 'planned', TRUE)",
        )
        .bind(uid)
        .bind(old_date)
        .bind(sched)
        .execute(&pool)
        .await
        .unwrap();

        let carryover = get_carryover(&pool, uid, plan_start).await.unwrap();

        assert_eq!(
            carryover.len(),
            1,
            "one-shot entry must be excluded from carryover"
        );
        assert_eq!(carryover[0].title.as_deref(), Some("carry-me"));
    }

    // -----------------------------------------------------------------------
    // H.6 — commit_plan silently drops one-shot entries from prior window
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn commit_plan_silently_drops_one_shot_entries_from_prior_window(pool: PgPool) {
        let uid = new_user(&pool).await;
        let plan_start = tomorrow();
        let plan_end = plan_start + Duration::days(6);

        let old_date = plan_start - Duration::days(1);
        let sched = old_date.and_hms_opt(10, 0, 0).unwrap().and_utc();

        // One-shot entry in prior window, not completed
        let one_shot_id: Uuid = sqlx::query_scalar(
            "INSERT INTO schedule_entries
               (user_id, task_type, title, date, scheduled_start, status, one_shot)
             VALUES ($1, 'general', 'teeth-brushing', $2, $3, 'planned', TRUE)
             RETURNING entry_id",
        )
        .bind(uid)
        .bind(old_date)
        .bind(sched)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Regular entry in prior window — must NOT be dropped
        let regular_id: Uuid = sqlx::query_scalar(
            "INSERT INTO schedule_entries
               (user_id, task_type, title, date, scheduled_start, status, one_shot)
             VALUES ($1, 'work', 'call-dentist', $2, $3, 'planned', FALSE)
             RETURNING entry_id",
        )
        .bind(uid)
        .bind(old_date)
        .bind(sched)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Deferred one-shot entry — must also be dropped
        let deferred_one_shot_id: Uuid = sqlx::query_scalar(
            "INSERT INTO schedule_entries
               (user_id, task_type, title, date, scheduled_start, status, one_shot)
             VALUES ($1, 'general', 'evening-stretches', $2, $3, 'deferred', TRUE)
             RETURNING entry_id",
        )
        .bind(uid)
        .bind(old_date)
        .bind(sched)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Completed one-shot entry — must NOT be affected
        let completed_one_shot_id: Uuid = sqlx::query_scalar(
            "INSERT INTO schedule_entries
               (user_id, task_type, title, date, scheduled_start, status, one_shot)
             VALUES ($1, 'general', 'morning-vitamins', $2, $3, 'completed', TRUE)
             RETURNING entry_id",
        )
        .bind(uid)
        .bind(old_date)
        .bind(sched)
        .fetch_one(&pool)
        .await
        .unwrap();

        let task_id = make_planning_task(&pool, uid, plan_start).await;
        let req = CommitPlanInput {
            plan_start,
            plan_end,
            planning_task_id: task_id,
            entries: vec![],
            replace: false,
            carryover_decisions: HashMap::new(),
            drop_reasons: HashMap::new(),
        };
        commit_plan(&pool, uid, &req).await.unwrap();

        let one_shot_status: String =
            sqlx::query_scalar("SELECT status FROM schedule_entries WHERE entry_id = $1")
                .bind(one_shot_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            one_shot_status, "skipped",
            "one-shot entry must be silently dropped"
        );

        let regular_status: String =
            sqlx::query_scalar("SELECT status FROM schedule_entries WHERE entry_id = $1")
                .bind(regular_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            regular_status, "planned",
            "non-one-shot entry must not be dropped"
        );

        let deferred_status: String =
            sqlx::query_scalar("SELECT status FROM schedule_entries WHERE entry_id = $1")
                .bind(deferred_one_shot_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            deferred_status, "skipped",
            "deferred one-shot entry must also be silently dropped"
        );

        let completed_status: String =
            sqlx::query_scalar("SELECT status FROM schedule_entries WHERE entry_id = $1")
                .bind(completed_one_shot_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            completed_status, "completed",
            "completed one-shot entry must not be affected by drop pass"
        );
    }

    // -----------------------------------------------------------------------
    // resolve_open_slots helpers
    // -----------------------------------------------------------------------

    async fn make_binary_day_type(pool: &PgPool, user_id: Uuid, days_bitmask: i32) -> DayType {
        use crate::db::day_type;
        let t = NaiveTime::from_hms_opt(7, 0, 0).unwrap();
        day_type::create(
            pool,
            user_id,
            "test-binary",
            days_bitmask,
            t,
            t,
            false,
            None,
            None,
            0,
        )
        .await
        .expect("failed to create binary day type")
    }

    async fn make_cycle_day_type(
        pool: &PgPool,
        user_id: Uuid,
        length: i32,
        anchor: NaiveDate,
        cycle_bitmask: i32,
    ) -> DayType {
        use crate::db::day_type;
        let t = NaiveTime::from_hms_opt(7, 0, 0).unwrap();
        day_type::create(
            pool,
            user_id,
            "test-cycle",
            0,
            t,
            t,
            true,
            Some(length),
            Some(anchor),
            cycle_bitmask,
        )
        .await
        .expect("failed to create cycle day type")
    }

    async fn add_meal(pool: &PgPool, day_type_id: Uuid, name: &str, sort_order: i32) {
        use crate::db::meal_pattern;
        let t = NaiveTime::from_hms_opt(8, 0, 0).unwrap();
        meal_pattern::create(pool, day_type_id, name, t, 60, sort_order)
            .await
            .expect("failed to create meal pattern entry");
    }

    // Monday 2026-05-11 as test anchor
    fn monday() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 5, 11).unwrap()
    }

    // -----------------------------------------------------------------------
    // resolve_open_slots tests
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn resolve_open_slots_binary_only_no_locked(pool: PgPool) {
        let uid = new_user(&pool).await;
        // Mon–Fri = bits 1..=5 = 0b0111110 = 62
        let dt = make_binary_day_type(&pool, uid, 62).await;
        add_meal(&pool, dt.id, "Breakfast", 0).await;
        add_meal(&pool, dt.id, "Dinner", 1).await;

        let start = monday(); // Mon 2026-05-11
        let end = start + Duration::days(6); // Sun 2026-05-17

        let slots = resolve_open_slots(&pool, uid, start, end, &[])
            .await
            .unwrap();

        // 5 weekdays × 2 meals = 10 slots
        assert_eq!(slots.len(), 10);
        // All should be on weekdays
        for slot in &slots {
            assert!(
                slot.date.weekday().num_days_from_monday() < 5,
                "expected weekday, got {:?}",
                slot.date
            );
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn resolve_open_slots_cycle_only_alternating(pool: PgPool) {
        let uid = new_user(&pool).await;
        let anchor = monday();
        // Length=2, bitmask=0b01 → matches anchor, anchor+2, anchor+4, … (even offsets)
        let dt = make_cycle_day_type(&pool, uid, 2, anchor, 0b01).await;
        add_meal(&pool, dt.id, "Lunch", 0).await;

        let start = anchor;
        let end = start + Duration::days(6);

        let slots = resolve_open_slots(&pool, uid, start, end, &[])
            .await
            .unwrap();

        // 4 matching days (offsets 0, 2, 4, 6) × 1 meal = 4 slots
        assert_eq!(slots.len(), 4);
        let expected_dates: Vec<NaiveDate> = [0, 2, 4, 6]
            .iter()
            .map(|&d| anchor + Duration::days(d))
            .collect();
        let slot_dates: Vec<NaiveDate> = slots.iter().map(|s| s.date).collect();
        assert_eq!(slot_dates, expected_dates);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn resolve_open_slots_mixed_day_types(pool: PgPool) {
        let uid = new_user(&pool).await;
        let anchor = monday();
        // Weekday day type (Mon–Fri) with Breakfast + Dinner
        let weekday_dt = make_binary_day_type(&pool, uid, 62).await;
        add_meal(&pool, weekday_dt.id, "Breakfast", 0).await;
        add_meal(&pool, weekday_dt.id, "Dinner", 1).await;
        // Weekend day type (Sat=bit6, Sun=bit0 = 0b1000001 = 65) with Brunch
        let weekend_dt = make_binary_day_type(&pool, uid, 65).await;
        add_meal(&pool, weekend_dt.id, "Brunch", 0).await;

        let start = anchor; // Mon
        let end = start + Duration::days(6); // Sun

        let slots = resolve_open_slots(&pool, uid, start, end, &[])
            .await
            .unwrap();

        // 5 weekdays × 2 meals + 2 weekend days × 1 meal = 12
        assert_eq!(slots.len(), 12);
        let breakfast_count = slots.iter().filter(|s| s.meal_name == "Breakfast").count();
        let brunch_count = slots.iter().filter(|s| s.meal_name == "Brunch").count();
        assert_eq!(breakfast_count, 5);
        assert_eq!(brunch_count, 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn resolve_open_slots_partial_locked(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dt = make_binary_day_type(&pool, uid, 62).await; // Mon–Fri
        add_meal(&pool, dt.id, "Breakfast", 0).await;
        add_meal(&pool, dt.id, "Dinner", 1).await;

        let start = monday();
        let end = start + Duration::days(4); // Mon–Fri only

        // Lock Breakfast on Mon and Dinner on Wed
        let locked = vec![
            (start, "Breakfast".to_string()),
            (start + Duration::days(2), "Dinner".to_string()),
        ];

        let slots = resolve_open_slots(&pool, uid, start, end, &locked)
            .await
            .unwrap();

        // 5 days × 2 meals − 2 locked = 8
        assert_eq!(slots.len(), 8);
        // Locked slots must not appear
        assert!(
            !slots
                .iter()
                .any(|s| s.date == start && s.meal_name == "Breakfast")
        );
        assert!(
            !slots
                .iter()
                .any(|s| s.date == start + Duration::days(2) && s.meal_name == "Dinner")
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn resolve_open_slots_all_locked_returns_empty(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dt = make_binary_day_type(&pool, uid, 62).await;
        add_meal(&pool, dt.id, "Breakfast", 0).await;

        let start = monday();
        let end = start + Duration::days(4); // Mon–Fri

        let locked: Vec<(NaiveDate, String)> = (0..5)
            .map(|d| (start + Duration::days(d), "Breakfast".to_string()))
            .collect();

        let slots = resolve_open_slots(&pool, uid, start, end, &locked)
            .await
            .unwrap();
        assert!(slots.is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn resolve_open_slots_single_day(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dt = make_binary_day_type(&pool, uid, 62).await; // Mon–Fri
        add_meal(&pool, dt.id, "Breakfast", 0).await;

        let day = monday();
        let slots = resolve_open_slots(&pool, uid, day, day, &[]).await.unwrap();

        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].date, day);
        assert_eq!(slots[0].meal_name, "Breakfast");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn resolve_open_slots_multi_week(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dt = make_binary_day_type(&pool, uid, 62).await; // Mon–Fri
        add_meal(&pool, dt.id, "Breakfast", 0).await;

        let start = monday();
        let end = start + Duration::days(20); // 21-day inclusive span ending on Sun 2026-05-31

        let slots = resolve_open_slots(&pool, uid, start, end, &[])
            .await
            .unwrap();

        // 3 full Mon–Fri weeks = 15 weekday slots; range ends on Sunday so no 16th
        assert_eq!(slots.len(), 15);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn resolve_open_slots_no_matching_day_type_skips_date(pool: PgPool) {
        let uid = new_user(&pool).await;
        // Wednesday-only day type (bit 3 = 0b0001000 = 8); all other days have no match
        let dt = make_binary_day_type(&pool, uid, 0b0001000).await;
        add_meal(&pool, dt.id, "Lunch", 0).await;

        let start = monday(); // Mon 2026-05-11
        let end = start + Duration::days(6); // Mon–Sun

        let slots = resolve_open_slots(&pool, uid, start, end, &[])
            .await
            .unwrap();

        // Only Wednesday (2026-05-13) produces a slot
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].date, start + Duration::days(2)); // Wed
        assert_eq!(slots[0].meal_name, "Lunch");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn resolve_open_slots_empty_range_returns_empty(pool: PgPool) {
        let uid = new_user(&pool).await;
        let dt = make_binary_day_type(&pool, uid, 62).await;
        add_meal(&pool, dt.id, "Breakfast", 0).await;

        let start = monday();
        // end < start → should return empty without panic
        let slots = resolve_open_slots(&pool, uid, start, start - Duration::days(1), &[])
            .await
            .unwrap();
        assert!(slots.is_empty());
    }
}
