use chrono::{NaiveDate, TimeZone};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::{
    PlanStatusResponse, PostSchedulePlanRequest, PostSchedulePlanResponse, ScheduleEntry,
    SchedulePeriodResponse,
};

const ENTRY_COLS: &str =
    "entry_id, user_id, template_id, task_type, task_ref_id, task_ref_type, title,
     date, scheduled_start, scheduled_end, status, actual_start, actual_end,
     family_meal_id, after_milepost, after_entry_id, deviation_note, created_at, updated_at";

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
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    let carryover: Vec<ScheduleEntry> = sqlx::query_as::<_, ScheduleEntry>(&format!(
        "SELECT {ENTRY_COLS} FROM schedule_entries
         WHERE user_id = $1 AND date < $2
           AND status IN ('planned', 'deferred')
         ORDER BY date, scheduled_start"
    ))
    .bind(user_id)
    .bind(start)
    .fetch_all(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    Ok(SchedulePeriodResponse { entries, carryover })
}

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
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    Ok(PlanStatusResponse {
        planned: row.0 > 0,
        entry_count: row.0,
    })
}

pub async fn commit_plan(
    pool: &PgPool,
    user_id: Uuid,
    req: &PostSchedulePlanRequest,
) -> Result<PostSchedulePlanResponse, DatabaseError> {
    let replace = req.replace.unwrap_or(false);
    let today = chrono::Utc::now().date_naive();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    // If replace=true, delete planned entries for unstarted days only
    if replace {
        // Find days with any in_progress or completed entry (these are "started")
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
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

        // Delete planned entries for unstarted days from today onward
        sqlx::query(
            "DELETE FROM schedule_entries
             WHERE user_id = $1
               AND date >= $2
               AND date >= $3
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
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
    }

    // Insert new entries
    let mut committed: i64 = 0;
    for entry in &req.entries {
        // Parse "HH:MM" + date into TIMESTAMPTZ (UTC)
        let time_parts: Vec<&str> = entry.scheduled_start.split(':').collect();
        if time_parts.len() != 2 {
            return Err(DatabaseError::QueryError(
                "invalid scheduled_start format".into(),
            ));
        }
        let hour: u32 = time_parts[0]
            .parse()
            .map_err(|_| DatabaseError::QueryError("invalid hour".into()))?;
        let minute: u32 = time_parts[1]
            .parse()
            .map_err(|_| DatabaseError::QueryError("invalid minute".into()))?;
        let scheduled_start = chrono::Utc.from_utc_datetime(
            &entry
                .date
                .and_hms_opt(hour, minute, 0)
                .ok_or_else(|| DatabaseError::QueryError("invalid time".into()))?,
        );

        sqlx::query(
            "INSERT INTO schedule_entries
               (user_id, task_type, task_ref_id, task_ref_type, title,
                date, scheduled_start, status, after_milepost)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'planned', $8)",
        )
        .bind(user_id)
        .bind(&entry.task_type)
        .bind(entry.task_ref_id)
        .bind(&entry.task_ref_type)
        .bind(&entry.title)
        .bind(entry.date)
        .bind(scheduled_start)
        .bind(&entry.after_milepost)
        .execute(&mut *tx)
        .await
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

        committed += 1;
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
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    // Apply carryover decisions: update carry-over entries
    for (entry_id_str, decision) in &req.carryover_decisions {
        let entry_id = match uuid::Uuid::parse_str(entry_id_str) {
            Ok(id) => id,
            Err(_) => continue,
        };
        match decision.as_str() {
            "accept" => {
                // Reschedule to the new horizon start, keeping status 'planned'
                sqlx::query(
                    "UPDATE schedule_entries SET date = $1, updated_at = NOW()
                     WHERE entry_id = $2 AND user_id = $3",
                )
                .bind(req.plan_start)
                .bind(entry_id)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
            }
            "defer" => {
                sqlx::query(
                    "UPDATE schedule_entries SET status = 'deferred', updated_at = NOW()
                     WHERE entry_id = $1 AND user_id = $2",
                )
                .bind(entry_id)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
            }
            "dismiss" => {
                sqlx::query(
                    "UPDATE schedule_entries SET status = 'skipped', updated_at = NOW()
                     WHERE entry_id = $1 AND user_id = $2",
                )
                .bind(entry_id)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
            }
            _ => continue,
        }
    }

    tx.commit()
        .await
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    Ok(PostSchedulePlanResponse {
        committed,
        planning_task_status: "completed".to_string(),
    })
}
