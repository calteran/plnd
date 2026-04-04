use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::{CarryoverDecision, CommitPlanInput, ScheduleEntry};
use crate::db::query_types::{
    PlanStatusResponse, PostSchedulePlanResponse, SchedulePeriodResponse,
};

/// Maximum number of days before the period start to search for carryover entries.
/// Older planned/deferred entries are excluded to prevent unbounded historical scans.
pub const CARRYOVER_LOOKBACK_DAYS: i64 = 90;

const ENTRY_COLS: &str =
    "entry_id, user_id, template_id, task_type, task_ref_id, task_ref_type, title,
     date, scheduled_start, scheduled_end, status, actual_start, actual_end,
     family_meal_id, after_milepost, after_entry_id, deviation_note, created_at, updated_at";

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

    let carryover_start = start - chrono::Duration::days(CARRYOVER_LOOKBACK_DAYS);
    let carryover: Vec<ScheduleEntry> = sqlx::query_as::<_, ScheduleEntry>(&format!(
        "SELECT {ENTRY_COLS} FROM schedule_entries
         WHERE user_id = $1 AND date < $2 AND date >= $3
           AND status IN ('planned', 'deferred')
         ORDER BY date, scheduled_start"
    ))
    .bind(user_id)
    .bind(start)
    .bind(carryover_start)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)?;

    Ok(SchedulePeriodResponse { entries, carryover })
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
    let mut task_types: Vec<String> = Vec::new();
    let mut task_ref_ids: Vec<Option<Uuid>> = Vec::new();
    let mut task_ref_types: Vec<Option<String>> = Vec::new();
    let mut titles: Vec<Option<String>> = Vec::new();
    let mut dates: Vec<NaiveDate> = Vec::new();
    let mut scheduled_starts: Vec<DateTime<Utc>> = Vec::new();
    let mut after_mileposts: Vec<Option<String>> = Vec::new();

    for entry in &req.entries {
        let scheduled_start = entry.date.and_time(entry.scheduled_start).and_utc();
        task_types.push(entry.task_type.clone());
        task_ref_ids.push(entry.task_ref_id);
        task_ref_types.push(entry.task_ref_type.clone());
        titles.push(entry.title.clone());
        dates.push(entry.date);
        scheduled_starts.push(scheduled_start);
        after_mileposts.push(entry.after_milepost.clone());
    }

    let committed = task_types.len() as i64;

    if !task_types.is_empty() {
        sqlx::query(
            "INSERT INTO schedule_entries
               (user_id, task_type, task_ref_id, task_ref_type, title,
                date, scheduled_start, status, after_milepost)
             SELECT $1, unnest($2::text[]), unnest($3::uuid[]), unnest($4::text[]),
                    unnest($5::text[]), unnest($6::date[]), unnest($7::timestamptz[]),
                    'planned', unnest($8::text[])",
        )
        .bind(user_id)
        .bind(&task_types)
        .bind(&task_ref_ids)
        .bind(&task_ref_types)
        .bind(&titles)
        .bind(&dates)
        .bind(&scheduled_starts)
        .bind(&after_mileposts)
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
            CarryoverDecision::Accept => {
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
            CarryoverDecision::Dismiss => {
                sqlx::query(
                    "UPDATE schedule_entries SET status = 'skipped', updated_at = NOW()
                     WHERE entry_id = $1 AND user_id = $2",
                )
                .bind(entry_id)
                .bind(user_id)
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Utc};
    use sqlx::PgPool;
    use uuid::Uuid;

    use super::*;
    use crate::db::{models::PlanEntryInput, tasks, users};

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
            task_type: "work".to_string(),
            task_ref_id: None,
            task_ref_type: None,
            title: Some("Test task".to_string()),
            scheduled_start: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            after_milepost: None,
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

        // Raw-insert 3 carryover entries dated before plan_start (within lookback window)
        let carryover_date = today - Duration::days(1);
        let sched = (carryover_date.and_hms_opt(9, 0, 0).unwrap()).and_utc();

        let id_accept: Uuid = sqlx::query_scalar(
            "INSERT INTO schedule_entries (user_id, task_type, title, date, scheduled_start, status)
             VALUES ($1, 'work', 'accept-me', $2, $3, 'planned') RETURNING entry_id",
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

        let id_dismiss: Uuid = sqlx::query_scalar(
            "INSERT INTO schedule_entries (user_id, task_type, title, date, scheduled_start, status)
             VALUES ($1, 'work', 'dismiss-me', $2, $3, 'planned') RETURNING entry_id",
        )
        .bind(uid)
        .bind(carryover_date)
        .bind(sched)
        .fetch_one(&pool)
        .await
        .unwrap();

        let task_id = make_planning_task(&pool, uid, plan_start).await;
        let mut decisions = HashMap::new();
        decisions.insert(id_accept, CarryoverDecision::Accept);
        decisions.insert(id_defer, CarryoverDecision::Defer);
        decisions.insert(id_dismiss, CarryoverDecision::Dismiss);

        let req = CommitPlanInput {
            plan_start,
            plan_end,
            planning_task_id: task_id,
            entries: vec![],
            replace: false,
            carryover_decisions: decisions,
        };
        commit_plan(&pool, uid, &req).await.unwrap();

        let (date_a, status_a, sched_a): (NaiveDate, String, DateTime<Utc>) = sqlx::query_as(
            "SELECT date, status, scheduled_start FROM schedule_entries WHERE entry_id = $1",
        )
        .bind(id_accept)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(date_a, plan_start, "Accept should reschedule to plan_start");
        assert_eq!(status_a, "planned");
        assert_eq!(
            sched_a.time(),
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
                .bind(id_dismiss)
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
        };
        commit_plan(&pool, uid, &initial_req).await.unwrap();

        // Second commit with replace=true but an invalid task_type that violates the DB CHECK.
        // The DELETE will run first, then the INSERT should fail, rolling back the whole tx.
        let task_id_2 = make_planning_task(&pool, uid, start + Duration::days(7)).await;
        let bad_entry = PlanEntryInput {
            date: start,
            task_type: "invalid_type".to_string(), // violates CHECK constraint
            task_ref_id: None,
            task_ref_type: None,
            title: None,
            scheduled_start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            after_milepost: None,
        };
        let bad_req = CommitPlanInput {
            plan_start: start,
            plan_end: end,
            planning_task_id: task_id_2,
            entries: vec![bad_entry],
            replace: true,
            carryover_decisions: HashMap::new(),
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
}
