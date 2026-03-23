# Weekly Planning Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the weekly planning wizard — a 5-step guided session where users review carryover tasks, schedule meals and tasks for the coming week, and commit the plan in one batch.

**Architecture:** Session-first wizard stored in Angular signals + localStorage. Backend exposes new endpoints for loading period data, committing plans, and auto-creating the planning task. Three new `user_preferences` columns drive horizon configuration. An optional `title` column is added to `schedule_entries` to support custom tasks that have no entity reference.

**Tech Stack:** Rust/Axum + sqlx + PostgreSQL; Angular 21 standalone components + signals + ReactiveFormsModule; localStorage draft persistence (`plnd:plan-draft`).

**Spec:** `docs/superpowers/specs/2026-03-23-weekly-planning-wizard-design.md`

---

## File Structure

### New Files

| Path | Responsibility |
|---|---|
| `plnd_api/migrations/0015_planning_preferences.sql` | Add 3 cols to `user_preferences`; add `title` to `schedule_entries` |
| `plnd_api/src/db/schedule.rs` | `get_period`, `get_plan_status`, `commit_plan`, `update_carryover_decisions` |
| `plnd_api/src/db/tasks.rs` | `create_weekly_plan_task` (idempotent dual-insert) |
| `plnd_api/src/routes/schedule.rs` | GET /schedule/period, GET /schedule/plan/status, POST /schedule/plan |
| `plnd_api/src/routes/tasks.rs` | POST /tasks/weekly-plan |
| `plnd_api/tests/schedule_test.rs` | Serde + constant tests for schedule types |
| `plnd_client/src/app/core/models/week-plan.ts` | TypeScript interfaces for wizard state |
| `plnd_client/src/app/core/services/week-plan.service.ts` | All wizard signals + API calls |
| `plnd_client/src/app/core/services/week-plan.service.spec.ts` | Service unit tests |
| `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.ts` | Root wizard container |
| `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.spec.ts` | Wizard container tests |
| `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.ts` | Step 1 |
| `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.spec.ts` | |
| `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.ts` | Step 2 |
| `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.spec.ts` | |
| `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts` | Step 3 |
| `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.spec.ts` | |
| `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-grid-step.ts` | Step 4 container |
| `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.ts` | Day card |
| `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-grid-step.spec.ts` | |
| `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.ts` | Step 5 |
| `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.spec.ts` | |

### Modified Files

| Path | Change |
|---|---|
| `plnd_api/src/db/models/mod.rs` | Add 3 fields to `UserPreferences`; add `ScheduleEntry`, `Task`, new request/response types |
| `plnd_api/src/db/mod.rs` | Export `schedule` and `tasks` modules |
| `plnd_api/src/db/preferences.rs` | Add `patch_preferences()` COALESCE update |
| `plnd_api/src/routes/mod.rs` | Export `schedule` and `tasks` modules |
| `plnd_api/src/routes/preferences.rs` | Add `patch_preferences` handler |
| `plnd_api/src/main.rs` | Wire 5 new routes + import new modules |
| `plnd_api/src/openapi.rs` | Register new response types |
| `plnd_client/src/app/core/models/preferences.ts` | Add 3 new fields + `UpdatePreferencesRequest` |
| `plnd_client/src/app/core/services/preferences.service.ts` | Add `patchPreferences()` |
| `plnd_client/src/app/core/services/auth.service.ts` | Call `weekPlanService.clear()` on logout |
| `plnd_client/src/app/app.routes.ts` | Add `/plan/week` lazy route |
| `plnd_client/src/app/layouts/main-layout/main-layout.html` | Add "Plan Week" sidebar + mobile tab |
| `plnd_client/src/app/layouts/main-layout/main-layout.ts` | Inject `WeekPlanService` |
| `plnd_client/src/app/layouts/main-layout/main-layout.spec.ts` | Add `HttpClientTestingModule` for `WeekPlanService` |
| `plnd_client/src/app/features/settings/settings.ts` | Add 3 planning preference fields |
| `plnd_client/src/app/features/settings/settings.spec.ts` | Add tests for 3 new fields |

---

## Task 1: Database Migration

**Files:**
- Create: `plnd_api/migrations/0015_planning_preferences.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0015: Planning horizon preferences + schedule entry title

ALTER TABLE user_preferences
  ADD COLUMN week_start_day           SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN planning_trigger_offset  SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN default_plan_length_days SMALLINT NOT NULL DEFAULT 7;

ALTER TABLE user_preferences
  ADD CONSTRAINT chk_week_start_day
    CHECK (week_start_day BETWEEN 0 AND 6),
  ADD CONSTRAINT chk_planning_trigger_offset
    CHECK (planning_trigger_offset BETWEEN -14 AND 14),
  ADD CONSTRAINT chk_default_plan_length_days
    CHECK (default_plan_length_days BETWEEN 1 AND 90);

-- Optional display title for schedule entries without an entity reference
-- (e.g., one-off custom tasks created in the planning wizard)
ALTER TABLE schedule_entries
  ADD COLUMN title VARCHAR(200);
```

- [ ] **Step 2: Verify migration runs**

```bash
just verify-build
```

Expected: compiles clean (sqlx checks run on next step)

- [ ] **Step 3: Commit**

```bash
git add plnd_api/migrations/0015_planning_preferences.sql
git commit -m "feat(db): add planning horizon prefs + schedule entry title (migration 0015)"
```

---

## Task 2: Backend Models

**Files:**
- Modify: `plnd_api/src/db/models/mod.rs`

- [ ] **Step 1: Update `UserPreferences` to include the three new columns**

Read `plnd_api/src/db/models/mod.rs` first. Find the `UserPreferences` struct (currently has 3 fields: `user_id`, `created_at`, `updated_at`) and replace it:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct UserPreferences {
    pub user_id: Uuid,
    pub week_start_day: i16,
    pub planning_trigger_offset: i16,
    pub default_plan_length_days: i16,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

- [ ] **Step 2: Add new model types after the existing structs (before the catalog section)**

```rust
// ---------------------------------------------------------------------------
// Tasks + Scheduling
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct Task {
    pub task_id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub task_type: String,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub duration_minutes: Option<i32>,
    pub energy_required: String,
    pub status: String,
    pub is_milepost: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct ScheduleEntry {
    pub entry_id: Uuid,
    pub user_id: Uuid,
    pub template_id: Option<Uuid>,
    pub task_type: String,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub title: Option<String>,
    pub date: NaiveDate,
    pub scheduled_start: DateTime<Utc>,
    pub scheduled_end: Option<DateTime<Utc>>,
    pub status: String,
    pub after_milepost: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct SchedulePeriodResponse {
    pub entries: Vec<ScheduleEntry>,
    pub carryover: Vec<ScheduleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct PlanStatusResponse {
    pub planned: bool,
    pub entry_count: i64,
}
```

- [ ] **Step 3: Add request types for PATCH preferences and POST schedule/plan**

```rust
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PatchPreferencesRequest {
    pub week_start_day: Option<i16>,
    pub planning_trigger_offset: Option<i16>,
    pub default_plan_length_days: Option<i16>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PlanEntryRequest {
    pub date: NaiveDate,
    pub task_type: String,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub title: Option<String>,
    pub scheduled_start: String, // "HH:MM" local time
    pub after_milepost: Option<String>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PostSchedulePlanRequest {
    pub plan_start: NaiveDate,
    pub plan_end: NaiveDate,
    pub planning_task_id: Uuid,
    pub entries: Vec<PlanEntryRequest>,
    pub replace: Option<bool>,
    /// Carryover decisions keyed by entry_id: "defer" | "dismiss" | "accept"
    #[serde(default)]
    pub carryover_decisions: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct PostSchedulePlanResponse {
    pub committed: i64,
    pub planning_task_status: String,
}
```

- [ ] **Step 4: Verify compilation**

```bash
just verify-build
```

Expected: may fail with missing `NaiveDate`/`NaiveTime` import — ensure `use chrono::{DateTime, NaiveDate, NaiveTime, Utc};` is at the top (it already is in this file).

- [ ] **Step 5: Fix `get_or_create` in `db/preferences.rs` to return new columns**

The existing `RETURNING user_id, created_at, updated_at` must include the 3 new columns:

```rust
sqlx::query_as::<_, UserPreferences>(
    "INSERT INTO user_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE
       SET updated_at = user_preferences.updated_at
     RETURNING user_id, week_start_day, planning_trigger_offset,
               default_plan_length_days, created_at, updated_at",
)
```

- [ ] **Step 6: Verify compilation again and run tests**

```bash
just verify-build
just test-ci
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add plnd_api/src/db/models/mod.rs plnd_api/src/db/preferences.rs
git commit -m "feat(backend): add schedule + task models; update UserPreferences fields"
```

---

## Task 3: Backend — PATCH /preferences/me

**Files:**
- Modify: `plnd_api/src/db/preferences.rs`
- Modify: `plnd_api/src/routes/preferences.rs`
- Modify: `plnd_api/src/main.rs`
- Modify: `plnd_api/src/routes/mod.rs` (no change needed — already exported)

- [ ] **Step 1: Write the failing test**

Create `plnd_api/tests/preferences_patch_test.rs`:

```rust
use plnd_api::db::models::PatchPreferencesRequest;

#[test]
fn test_patch_preferences_request_all_fields() {
    let json = r#"{"week_start_day":1,"planning_trigger_offset":-1,"default_plan_length_days":7}"#;
    let req: PatchPreferencesRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.week_start_day, Some(1));
    assert_eq!(req.planning_trigger_offset, Some(-1));
    assert_eq!(req.default_plan_length_days, Some(7));
}

#[test]
fn test_patch_preferences_request_partial() {
    let json = r#"{"week_start_day":0}"#;
    let req: PatchPreferencesRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.week_start_day, Some(0));
    assert!(req.planning_trigger_offset.is_none());
    assert!(req.default_plan_length_days.is_none());
}

#[test]
fn test_patch_preferences_request_empty() {
    let json = r#"{}"#;
    let req: PatchPreferencesRequest = serde_json::from_str(json).unwrap();
    assert!(req.week_start_day.is_none());
    assert!(req.planning_trigger_offset.is_none());
    assert!(req.default_plan_length_days.is_none());
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
just test-ci
```

Expected: FAIL — `plnd_api::db::models::PatchPreferencesRequest` not public yet

- [ ] **Step 3: Make `PatchPreferencesRequest` public in models**

Add `pub use` to `plnd_api/src/db/models/mod.rs` — the struct is already pub; also ensure `plnd_api/src/lib.rs` exports `db::models`. Verify the test can import it.

- [ ] **Step 4: Add `patch_preferences()` to `plnd_api/src/db/preferences.rs`**

```rust
use crate::db::models::PatchPreferencesRequest;

/// Update only the provided planning-horizon preference fields for a user.
pub async fn patch_preferences(
    pool: &PgPool,
    user_id: Uuid,
    req: &PatchPreferencesRequest,
) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "UPDATE user_preferences
         SET
           week_start_day           = COALESCE($2, week_start_day),
           planning_trigger_offset  = COALESCE($3, planning_trigger_offset),
           default_plan_length_days = COALESCE($4, default_plan_length_days),
           updated_at               = NOW()
         WHERE user_id = $1
         RETURNING user_id, week_start_day, planning_trigger_offset,
                   default_plan_length_days, created_at, updated_at",
    )
    .bind(user_id)
    .bind(req.week_start_day)
    .bind(req.planning_trigger_offset)
    .bind(req.default_plan_length_days)
    .fetch_one(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}
```

- [ ] **Step 5: Add `patch_preferences` handler to `plnd_api/src/routes/preferences.rs`**

```rust
use crate::db::models::{PatchPreferencesRequest, UserPreferences};

#[utoipa::path(
    patch,
    path = "/preferences/me",
    tag = "Preferences",
    request_body = PatchPreferencesRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Updated preferences", body = UserPreferences),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Validation error"),
        (status = 500, description = "Internal server error"),
    )
)]
pub async fn patch_preferences(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PatchPreferencesRequest>,
) -> Result<Json<UserPreferences>, StatusCode> {
    // Validate ranges
    if let Some(wsd) = body.week_start_day {
        if !(0..=6).contains(&wsd) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    if let Some(pto) = body.planning_trigger_offset {
        if !(-14..=14).contains(&pto) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    if let Some(lpd) = body.default_plan_length_days {
        if !(1..=90).contains(&lpd) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }

    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    // Ensure the row exists first
    db::preferences::get_or_create(pool, user_id)
        .await
        .map_err(|e| {
            eprintln!("patch_preferences get_or_create error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    db::preferences::patch_preferences(pool, user_id, &body)
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("patch_preferences update error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
```

- [ ] **Step 6: Wire PATCH route in `main.rs`**

After line `.route("/preferences/me", get(preferences::get_preferences))`, add:

```rust
.route("/preferences/me", patch(preferences::patch_preferences))
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
just test-ci
```

Expected: PASS — all tests including the 3 new serde tests

- [ ] **Step 8: Commit**

```bash
git add plnd_api/src/db/preferences.rs plnd_api/src/routes/preferences.rs \
        plnd_api/src/main.rs plnd_api/tests/preferences_patch_test.rs
git commit -m "feat(api): add PATCH /preferences/me for planning horizon settings"
```

---

## Task 4: Backend — POST /tasks/weekly-plan

**Files:**
- Create: `plnd_api/src/db/tasks.rs`
- Create: `plnd_api/src/routes/tasks.rs`
- Modify: `plnd_api/src/db/mod.rs`
- Modify: `plnd_api/src/routes/mod.rs`
- Modify: `plnd_api/src/main.rs`

- [ ] **Step 1: Write the failing test in `plnd_api/tests/schedule_test.rs`**

```rust
use plnd_api::db::models::{PostSchedulePlanRequest, PostSchedulePlanResponse,
                            PlanEntryRequest, PlanStatusResponse};
use chrono::NaiveDate;
use uuid::Uuid;

#[test]
fn test_plan_entry_request_serde() {
    let json = r#"{
        "date": "2026-03-24",
        "task_type": "meal",
        "task_ref_id": "00000000-0000-0000-0000-000000000001",
        "task_ref_type": "user_meal",
        "scheduled_start": "08:00",
        "after_milepost": "breakfast"
    }"#;
    let req: PlanEntryRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.task_type, "meal");
    assert_eq!(req.scheduled_start, "08:00");
    assert_eq!(req.after_milepost, Some("breakfast".to_string()));
    assert!(req.title.is_none());
}

#[test]
fn test_plan_entry_request_custom_task_with_title() {
    let json = r#"{
        "date": "2026-03-24",
        "task_type": "custom",
        "title": "Morning walk",
        "scheduled_start": "07:00"
    }"#;
    let req: PlanEntryRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.task_type, "custom");
    assert_eq!(req.title, Some("Morning walk".to_string()));
    assert!(req.task_ref_id.is_none());
}

#[test]
fn test_post_schedule_plan_request_serde() {
    let json = r#"{
        "plan_start": "2026-03-24",
        "plan_end": "2026-03-30",
        "planning_task_id": "00000000-0000-0000-0000-000000000002",
        "entries": [],
        "replace": true
    }"#;
    let req: PostSchedulePlanRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.plan_start, NaiveDate::from_ymd_opt(2026, 3, 24).unwrap());
    assert_eq!(req.replace, Some(true));
    assert!(req.entries.is_empty());
}

#[test]
fn test_plan_status_response_serde() {
    let json = r#"{"planned":false,"entry_count":0}"#;
    let resp: PlanStatusResponse = serde_json::from_str(json).unwrap();
    assert!(!resp.planned);
    assert_eq!(resp.entry_count, 0);
}
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
just test-ci
```

Expected: FAIL — types not yet accessible from tests

- [ ] **Step 3: Create `plnd_api/src/db/tasks.rs`**

```rust
use chrono::{NaiveDate, TimeZone, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::Task;

/// Idempotently create the "Plan your week" generic task for a horizon.
/// Inserts into `tasks` + `generic_tasks` in a transaction.
/// Returns existing task if one already exists for the given plan_start.
pub async fn create_weekly_plan_task(
    pool: &PgPool,
    user_id: Uuid,
    plan_start: NaiveDate,
    trigger_offset: i16,
) -> Result<Task, DatabaseError> {
    let trigger_date = plan_start + chrono::Duration::days(trigger_offset as i64);
    // Midnight UTC on the trigger date
    let scheduled_start = Utc
        .from_utc_datetime(&trigger_date.and_hms_opt(0, 0, 0).unwrap());

    // Idempotency: check for existing weekly_plan task at this horizon
    let existing: Option<Task> = sqlx::query_as::<_, Task>(
        "SELECT t.task_id, t.user_id, t.title, t.task_type, t.scheduled_start,
                t.duration_minutes, t.energy_required, t.status, t.is_milepost,
                t.created_at, t.updated_at
         FROM tasks t
         JOIN generic_tasks gt USING (task_id)
         WHERE t.user_id = $1
           AND gt.category = 'weekly_plan'
           AND t.scheduled_start >= $2
           AND t.scheduled_start < $3
         LIMIT 1",
    )
    .bind(user_id)
    .bind(Utc.from_utc_datetime(&plan_start.and_hms_opt(0, 0, 0).unwrap()))
    .bind(Utc.from_utc_datetime(
        &(plan_start + chrono::Duration::days(90)).and_hms_opt(0, 0, 0).unwrap(),
    ))
    .fetch_optional(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    if let Some(task) = existing {
        return Ok(task);
    }

    // Create in a transaction: tasks + generic_tasks
    let mut tx = pool.begin().await.map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    let task: Task = sqlx::query_as::<_, Task>(
        "INSERT INTO tasks (user_id, title, task_type, scheduled_start, energy_required, status)
         VALUES ($1, 'Plan your week', 'custom', $2, 'low', 'planned')
         RETURNING task_id, user_id, title, task_type, scheduled_start, duration_minutes,
                   energy_required, status, is_milepost, created_at, updated_at",
    )
    .bind(user_id)
    .bind(scheduled_start)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    sqlx::query(
        "INSERT INTO generic_tasks (task_id, category, priority)
         VALUES ($1, 'weekly_plan', 'normal')",
    )
    .bind(task.task_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    tx.commit().await.map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    Ok(task)
}
```

- [ ] **Step 4: Create `plnd_api/src/routes/tasks.rs`**

```rust
use crate::auth::jwt::Claims;
use crate::db;
use crate::db::models::Task;
use crate::state::AppState;
use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct WeeklyPlanQuery {
    pub plan_start: NaiveDate,
}

#[utoipa::path(
    post,
    path = "/tasks/weekly-plan",
    tag = "Tasks",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Existing or newly created planning task", body = Task),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
pub async fn post_weekly_plan_task(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<WeeklyPlanQuery>,
) -> Result<Json<Task>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    // Read trigger_offset from the user's stored preferences (not client-supplied)
    let prefs = db::preferences::get_or_create(pool, user_id)
        .await
        .map_err(|e| {
            eprintln!("post_weekly_plan_task get_prefs error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    db::tasks::create_weekly_plan_task(pool, user_id, params.plan_start, prefs.planning_trigger_offset)
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("post_weekly_plan_task error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
```

- [ ] **Step 5: Export modules**

In `plnd_api/src/db/mod.rs`, add:
```rust
pub mod schedule;
pub mod tasks;
```

In `plnd_api/src/routes/mod.rs`, add:
```rust
pub mod schedule;
pub mod tasks;
```

- [ ] **Step 6: Wire route in `main.rs`**

Add to imports at top:
```rust
use plnd_api::routes::{/* existing */, schedule, tasks};
```

Add to the `protected` router:
```rust
.route("/tasks/weekly-plan", post(tasks::post_weekly_plan_task))
```

- [ ] **Step 7: Run tests to confirm PASS**

```bash
just test-ci
```

Expected: PASS — all schedule serde tests should now compile and pass

- [ ] **Step 8: Commit**

```bash
git add plnd_api/src/db/tasks.rs plnd_api/src/routes/tasks.rs \
        plnd_api/src/db/mod.rs plnd_api/src/routes/mod.rs \
        plnd_api/src/main.rs plnd_api/tests/schedule_test.rs
git commit -m "feat(api): add POST /tasks/weekly-plan (idempotent planning task creation)"
```

---

## Task 5: Backend — GET /schedule/period + GET /schedule/plan/status

**Files:**
- Create: `plnd_api/src/db/schedule.rs`
- Create: `plnd_api/src/routes/schedule.rs`
- Modify: `plnd_api/src/main.rs`

- [ ] **Step 1: Add tests for SchedulePeriodResponse and ScheduleEntry to `tests/schedule_test.rs`**

```rust
use plnd_api::db::models::SchedulePeriodResponse;

#[test]
fn test_schedule_period_response_empty() {
    let json = r#"{"entries":[],"carryover":[]}"#;
    let resp: SchedulePeriodResponse = serde_json::from_str(json).unwrap();
    assert!(resp.entries.is_empty());
    assert!(resp.carryover.is_empty());
}
```

- [ ] **Step 2: Create `plnd_api/src/db/schedule.rs`**

```rust
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::{PlanStatusResponse, ScheduleEntry, SchedulePeriodResponse};

const ENTRY_COLS: &str =
    "entry_id, user_id, template_id, task_type, task_ref_id, task_ref_type, title,
     date, scheduled_start, scheduled_end, status, after_milepost, created_at, updated_at";

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
```

- [ ] **Step 3: Create `plnd_api/src/routes/schedule.rs` (GET handlers only)**

```rust
use crate::auth::jwt::Claims;
use crate::db;
use crate::db::models::{PlanStatusResponse, SchedulePeriodResponse};
use crate::state::AppState;
use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct PeriodQuery {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

#[utoipa::path(
    get,
    path = "/schedule/period",
    tag = "Schedule",
    params(("start" = NaiveDate, Query, description = "Start date"), ("end" = NaiveDate, Query, description = "End date")),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Schedule entries and carryover", body = SchedulePeriodResponse),
        (status = 400, description = "Invalid date range"),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn get_period(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<PeriodQuery>,
) -> Result<Json<SchedulePeriodResponse>, StatusCode> {
    if params.end < params.start {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::schedule::get_period(pool, user_id, params.start, params.end)
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("get_period error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    get,
    path = "/schedule/plan/status",
    tag = "Schedule",
    params(("start" = NaiveDate, Query, description = "Horizon start"), ("end" = NaiveDate, Query, description = "Horizon end")),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Plan status", body = PlanStatusResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn get_plan_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<PeriodQuery>,
) -> Result<Json<PlanStatusResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::schedule::get_plan_status(pool, user_id, params.start, params.end)
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("get_plan_status error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
```

- [ ] **Step 4: Wire routes in `main.rs`**

```rust
.route("/schedule/period", get(schedule::get_period))
.route("/schedule/plan/status", get(schedule::get_plan_status))
```

- [ ] **Step 5: Run tests**

```bash
just test-ci
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plnd_api/src/db/schedule.rs plnd_api/src/routes/schedule.rs \
        plnd_api/src/main.rs plnd_api/tests/schedule_test.rs
git commit -m "feat(api): add GET /schedule/period and GET /schedule/plan/status"
```

---

## Task 6: Backend — POST /schedule/plan

**Files:**
- Modify: `plnd_api/src/db/schedule.rs`
- Modify: `plnd_api/src/routes/schedule.rs`
- Modify: `plnd_api/src/main.rs`

- [ ] **Step 1: Add `commit_plan()` to `plnd_api/src/db/schedule.rs`**

```rust
use crate::db::models::{PostSchedulePlanRequest, PostSchedulePlanResponse};

pub async fn commit_plan(
    pool: &PgPool,
    user_id: Uuid,
    req: &PostSchedulePlanRequest,
) -> Result<PostSchedulePlanResponse, DatabaseError> {
    let replace = req.replace.unwrap_or(false);
    let today = chrono::Utc::now().date_naive();

    let mut tx = pool.begin().await.map_err(|e| DatabaseError::QueryError(e.to_string()))?;

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
            return Err(DatabaseError::QueryError("invalid scheduled_start format".into()));
        }
        let hour: u32 = time_parts[0].parse().map_err(|_| DatabaseError::QueryError("invalid hour".into()))?;
        let minute: u32 = time_parts[1].parse().map_err(|_| DatabaseError::QueryError("invalid minute".into()))?;
        let scheduled_start = chrono::Utc.from_utc_datetime(
            &entry.date.and_hms_opt(hour, minute, 0)
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

    // Apply carryover decisions: update statuses of carry-over entries
    // (passed as extra fields on PostSchedulePlanRequest — see struct below)
    for (entry_id_str, decision) in &req.carryover_decisions {
        let entry_id = match uuid::Uuid::parse_str(entry_id_str) {
            Ok(id) => id,
            Err(_) => continue,
        };
        let new_status = match decision.as_str() {
            "defer"   => "deferred",
            "dismiss" => "skipped",
            "accept"  => continue, // accepted items remain; wizard adds them explicitly via entries
            _         => continue,
        };
        sqlx::query(
            "UPDATE schedule_entries SET status = $1, updated_at = NOW()
             WHERE entry_id = $2 AND user_id = $3",
        )
        .bind(new_status)
        .bind(entry_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
    }

    tx.commit().await.map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    Ok(PostSchedulePlanResponse {
        committed,
        planning_task_status: "completed".to_string(),
    })
}
```

- [ ] **Step 2: Add `post_plan` handler to `plnd_api/src/routes/schedule.rs`**

```rust
use crate::db::models::{PostSchedulePlanRequest, PostSchedulePlanResponse};

#[utoipa::path(
    post,
    path = "/schedule/plan",
    tag = "Schedule",
    request_body = PostSchedulePlanRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Plan committed", body = PostSchedulePlanResponse),
        (status = 400, description = "Invalid request"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
pub async fn post_plan(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PostSchedulePlanRequest>,
) -> Result<Json<PostSchedulePlanResponse>, StatusCode> {
    if body.plan_end < body.plan_start {
        return Err(StatusCode::BAD_REQUEST);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::schedule::commit_plan(pool, user_id, &body)
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("post_plan error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
```

- [ ] **Step 3: Wire in `main.rs`**

```rust
.route("/schedule/plan", post(schedule::post_plan))
```

- [ ] **Step 4: Add serde test for PostSchedulePlanResponse**

In `tests/schedule_test.rs`:

```rust
use plnd_api::db::models::PostSchedulePlanResponse;

#[test]
fn test_post_schedule_plan_response_serde() {
    let resp = PostSchedulePlanResponse {
        committed: 14,
        planning_task_status: "completed".to_string(),
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("14"));
    assert!(json.contains("completed"));
}
```

- [ ] **Step 5: Run tests and verify build**

```bash
just test-ci
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plnd_api/src/db/schedule.rs plnd_api/src/routes/schedule.rs \
        plnd_api/src/main.rs plnd_api/tests/schedule_test.rs
git commit -m "feat(api): add POST /schedule/plan with replace support"
```

---

## Task 7: Frontend — TypeScript Models

**Files:**
- Create: `plnd_client/src/app/core/models/week-plan.ts`
- Modify: `plnd_client/src/app/core/models/preferences.ts`

- [ ] **Step 1: Create `week-plan.ts`**

```typescript
export type CarryoverDecision = 'defer' | 'dismiss' | 'accept';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type EnergyLevel = 'low' | 'medium' | 'high';

export interface CarryoverItem {
  entry_id: string;
  title: string | null;
  task_type: string;
  date: string;
  status: string;
}

export interface PlannedMeal {
  type: 'user_meal' | 'mock';
  id?: string;
  title: string;
}

export interface PlannedTask {
  date: string;
  title: string;
  duration?: number;
  energy: EnergyLevel;
  task_type?: string;
  task_ref_id?: string;
  task_ref_type?: string;
  scheduled_start?: string; // "HH:MM"
}

export interface PlanDraftShape {
  schemaVersion: 1;
  planStart: string;
  planEnd: string;
  currentStep: number;
  carryoverDecisions: Record<string, CarryoverDecision>;
  scheduledMeals: Record<string, Partial<Record<MealSlot, PlannedMeal>>>;
  scheduledTasks: PlannedTask[];
  savedAt: string;
}

export interface ScheduleEntryDto {
  entry_id: string;
  task_type: string;
  task_ref_id?: string;
  task_ref_type?: string;
  title?: string;
  date: string;
  scheduled_start: string;
  status: string;
  after_milepost?: string;
}

export interface SchedulePeriodResponse {
  entries: ScheduleEntryDto[];
  carryover: ScheduleEntryDto[];
}

export interface PlanStatusResponse {
  planned: boolean;
  entry_count: number;
}

export interface PlanEntryRequest {
  date: string;
  task_type: string;
  task_ref_id?: string;
  task_ref_type?: string;
  title?: string;
  scheduled_start: string; // "HH:MM"
  after_milepost?: string;
}

export interface PostSchedulePlanRequest {
  plan_start: string;
  plan_end: string;
  planning_task_id: string;
  entries: PlanEntryRequest[];
  replace?: boolean;
  /** Carryover decisions: entry_id → "defer" | "dismiss" | "accept" */
  carryover_decisions?: Record<string, CarryoverDecision>;
}

export interface PostSchedulePlanResponse {
  committed: number;
  planning_task_status: string;
}

export const MOCK_MEAL_SUGGESTIONS: string[] = [
  'Oatmeal', 'Scrambled Eggs', 'Yogurt & Fruit',
  'Salad', 'Sandwich', 'Soup',
  'Pasta', 'Stir Fry', 'Grilled Chicken',
  'Smoothie', 'Leftovers',
];

// TODO(phase-3): replace mock array with WeekPlanService.getMealSuggestions()
export function getMockSuggestion(date: string, slot: MealSlot): string {
  const hash = date.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const slotIndex = ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(slot);
  return MOCK_MEAL_SUGGESTIONS[(hash + slotIndex) % MOCK_MEAL_SUGGESTIONS.length];
}
```

- [ ] **Step 2: Update `preferences.ts`**

```typescript
export interface UserPreferences {
  user_id: string;
  week_start_day: number;          // 0=Sun … 6=Sat
  planning_trigger_offset: number; // signed days relative to plan_start
  default_plan_length_days: number; // 1–90
  created_at: string;
  updated_at: string;
}

export interface UpdatePreferencesRequest {
  week_start_day?: number;
  planning_trigger_offset?: number;
  default_plan_length_days?: number;
}
```

- [ ] **Step 3: Run Angular tests**

```bash
just test-ng-headless
```

Expected: PASS — existing tests unaffected by adding new fields to interface

- [ ] **Step 4: Commit**

```bash
git add plnd_client/src/app/core/models/week-plan.ts \
        plnd_client/src/app/core/models/preferences.ts
git commit -m "feat(client): add week-plan TypeScript models + update preferences interface"
```

---

## Task 8: Frontend — WeekPlanService

**Files:**
- Create: `plnd_client/src/app/core/services/week-plan.service.ts`
- Create: `plnd_client/src/app/core/services/week-plan.service.spec.ts`
- Modify: `plnd_client/src/app/core/services/preferences.service.ts`
- Modify: `plnd_client/src/app/core/services/auth.service.ts`

- [ ] **Step 1: Write the failing spec first**

Create `plnd_client/src/app/core/services/week-plan.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { WeekPlanService } from './week-plan.service';

describe('WeekPlanService', () => {
  let service: WeekPlanService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should initialise with step 1 when no draft exists', () => {
    service.initSession('2026-03-24', '2026-03-30');
    expect(service.currentStep()).toBe(1);
    expect(service.planStart()).toBe('2026-03-24');
  });

  it('should restore step from valid draft', () => {
    const draft = {
      schemaVersion: 1,
      planStart: '2026-03-24',
      planEnd: '2026-03-30',
      currentStep: 3,
      carryoverDecisions: {},
      scheduledMeals: {},
      scheduledTasks: [],
      savedAt: '2026-03-23T12:00:00Z',
    };
    localStorage.setItem('plnd:plan-draft', JSON.stringify(draft));
    service.initSession('2026-03-24', '2026-03-30');
    expect(service.currentStep()).toBe(3);
  });

  it('should not restore draft when plan_start does not match', () => {
    const draft = {
      schemaVersion: 1,
      planStart: '2026-03-17', // different week
      planEnd: '2026-03-23',
      currentStep: 3,
      carryoverDecisions: {},
      scheduledMeals: {},
      scheduledTasks: [],
      savedAt: '2026-03-23T12:00:00Z',
    };
    localStorage.setItem('plnd:plan-draft', JSON.stringify(draft));
    service.initSession('2026-03-24', '2026-03-30');
    expect(service.currentStep()).toBe(1);
  });

  it('should save and load draft round-trip', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.goToStep(2);
    const loaded = service.loadDraft();
    expect(loaded?.currentStep).toBe(2);
    expect(loaded?.planStart).toBe('2026-03-24');
  });

  it('clearDraft should remove localStorage entry', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.saveDraft();
    expect(localStorage.getItem('plnd:plan-draft')).not.toBeNull();
    service.clearDraft();
    expect(localStorage.getItem('plnd:plan-draft')).toBeNull();
  });

  it('setCarryoverDecision updates decisions signal', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.setCarryoverDecision('task-1', 'defer');
    expect(service.carryoverDecisions()['task-1']).toBe('defer');
  });

  it('setMeal updates scheduledMeals signal', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.setMeal('2026-03-24', 'breakfast', { type: 'mock', title: 'Oatmeal' });
    expect(service.scheduledMeals()['2026-03-24']?.['breakfast']?.title).toBe('Oatmeal');
  });

  it('addTask and removeTask update scheduledTasks signal', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.addTask({ date: '2026-03-24', title: 'Walk', energy: 'low' });
    expect(service.scheduledTasks().length).toBe(1);
    service.removeTask(0);
    expect(service.scheduledTasks().length).toBe(0);
  });

  it('hasUnplannedHorizon defaults to false', () => {
    expect(service.hasUnplannedHorizon()).toBe(false);
  });

  it('clear resets all signals', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.addTask({ date: '2026-03-24', title: 'Walk', energy: 'low' });
    service.clear();
    expect(service.planStart()).toBe('');
    expect(service.scheduledTasks().length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
just test-ng-headless
```

Expected: FAIL — `WeekPlanService` does not exist

- [ ] **Step 3: Create `plnd_client/src/app/core/services/week-plan.service.ts`**

```typescript
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, tap, throwError } from 'rxjs';
import { ConfigService } from './config.service';
import {
  CarryoverDecision, EnergyLevel, MealSlot, PlanDraftShape,
  PlanEntryRequest, PlannedMeal, PlannedTask,
  PostSchedulePlanRequest, PostSchedulePlanResponse,
  PlanStatusResponse, SchedulePeriodResponse,
} from '../models/week-plan';

@Injectable({ providedIn: 'root' })
export class WeekPlanService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly DRAFT_KEY = 'plnd:plan-draft';
  private readonly SCHEMA_VERSION = 1;

  private readonly planStartSignal = signal<string>('');
  private readonly planEndSignal = signal<string>('');
  private readonly currentStepSignal = signal<number>(1);
  private readonly carryoverItemsSignal = signal<SchedulePeriodResponse['carryover']>([]);
  private readonly scheduledTasksSignal = signal<PlannedTask[]>([]);
  private readonly scheduledMealsSignal = signal<Record<string, Partial<Record<MealSlot, PlannedMeal>>>>({});
  private readonly carryoverDecisionsSignal = signal<Record<string, CarryoverDecision>>({});
  private readonly hasUnplannedHorizonSignal = signal<boolean>(false);
  private readonly isSubmittingSignal = signal<boolean>(false);

  readonly planStart = this.planStartSignal.asReadonly();
  readonly planEnd = this.planEndSignal.asReadonly();
  readonly currentStep = this.currentStepSignal.asReadonly();
  readonly carryoverItems = this.carryoverItemsSignal.asReadonly();
  readonly scheduledTasks = this.scheduledTasksSignal.asReadonly();
  readonly scheduledMeals = this.scheduledMealsSignal.asReadonly();
  readonly carryoverDecisions = this.carryoverDecisionsSignal.asReadonly();
  readonly hasUnplannedHorizon = this.hasUnplannedHorizonSignal.asReadonly();
  readonly isSubmitting = this.isSubmittingSignal.asReadonly();

  initSession(start: string, end: string): void {
    this.planStartSignal.set(start);
    this.planEndSignal.set(end);
    const draft = this.loadDraft();
    if (draft && draft.planStart === start) {
      this.currentStepSignal.set(draft.currentStep);
      this.carryoverDecisionsSignal.set(draft.carryoverDecisions);
      this.scheduledMealsSignal.set(draft.scheduledMeals);
      this.scheduledTasksSignal.set(draft.scheduledTasks);
    } else {
      this.currentStepSignal.set(1);
      this.carryoverDecisionsSignal.set({});
      this.scheduledMealsSignal.set({});
      this.scheduledTasksSignal.set([]);
    }
  }

  goToStep(step: number): void {
    this.currentStepSignal.set(step);
    this.saveDraft();
  }

  saveDraft(): void {
    const draft: PlanDraftShape = {
      schemaVersion: 1,
      planStart: this.planStartSignal(),
      planEnd: this.planEndSignal(),
      currentStep: this.currentStepSignal(),
      carryoverDecisions: this.carryoverDecisionsSignal(),
      scheduledMeals: this.scheduledMealsSignal(),
      scheduledTasks: this.scheduledTasksSignal(),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(this.DRAFT_KEY, JSON.stringify(draft));
  }

  loadDraft(): PlanDraftShape | null {
    try {
      const raw = localStorage.getItem(this.DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PlanDraftShape;
      if (parsed.schemaVersion !== this.SCHEMA_VERSION) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  clearDraft(): void {
    localStorage.removeItem(this.DRAFT_KEY);
  }

  loadPeriod(start: string, end: string): Observable<SchedulePeriodResponse> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http
      .get<SchedulePeriodResponse>(`${apiBase}/schedule/period?start=${start}&end=${end}`)
      .pipe(tap(resp => this.carryoverItemsSignal.set(resp.carryover)));
  }

  checkPlanStatus(start: string, end: string): void {
    const apiBase = this.config.getConfig().api.baseUrl;
    this.http
      .get<PlanStatusResponse>(`${apiBase}/schedule/plan/status?start=${start}&end=${end}`)
      .subscribe({
        next: resp => this.hasUnplannedHorizonSignal.set(!resp.planned),
        error: () => {},
      });
  }

  commitPlan(taskId: string, replace = false): Observable<PostSchedulePlanResponse> {
    this.isSubmittingSignal.set(true);
    const apiBase = this.config.getConfig().api.baseUrl;
    const req = this.buildCommitRequest(taskId, replace);
    return this.http.post<PostSchedulePlanResponse>(`${apiBase}/schedule/plan`, req).pipe(
      tap(() => {
        this.clearDraft();
        this.hasUnplannedHorizonSignal.set(false);
        this.isSubmittingSignal.set(false);
      }),
      catchError(err => {
        this.isSubmittingSignal.set(false);
        return throwError(() => err);
      })
    );
  }

  setCarryoverDecision(entryId: string, decision: CarryoverDecision): void {
    this.carryoverDecisionsSignal.update(d => ({ ...d, [entryId]: decision }));
  }

  setMeal(date: string, slot: MealSlot, meal: PlannedMeal): void {
    this.scheduledMealsSignal.update(m => ({
      ...m,
      [date]: { ...(m[date] ?? {}), [slot]: meal },
    }));
  }

  clearMeal(date: string, slot: MealSlot): void {
    this.scheduledMealsSignal.update(m => {
      const day = { ...(m[date] ?? {}) };
      delete day[slot];
      return { ...m, [date]: day };
    });
  }

  addTask(task: PlannedTask): void {
    this.scheduledTasksSignal.update(t => [...t, task]);
  }

  removeTask(index: number): void {
    this.scheduledTasksSignal.update(t => t.filter((_, i) => i !== index));
  }

  /** Days in the horizon as ISO date strings (inclusive). */
  horizonDays(): string[] {
    const start = this.planStartSignal();
    const end = this.planEndSignal();
    if (!start || !end) return [];
    // Parse as local-noon to avoid UTC-offset day rollback
    const cur = new Date(`${start}T12:00:00`);
    const endDate = new Date(`${end}T12:00:00`);
    const days: string[] = [];
    while (cur <= endDate) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      days.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  clear(): void {
    this.planStartSignal.set('');
    this.planEndSignal.set('');
    this.currentStepSignal.set(1);
    this.carryoverItemsSignal.set([]);
    this.scheduledTasksSignal.set([]);
    this.scheduledMealsSignal.set({});
    this.carryoverDecisionsSignal.set({});
    this.isSubmittingSignal.set(false);
  }

  private buildCommitRequest(taskId: string, replace: boolean): PostSchedulePlanRequest {
    const meals = this.scheduledMealsSignal();
    const tasks = this.scheduledTasksSignal();
    const entries: PlanEntryRequest[] = [];

    for (const [date, slots] of Object.entries(meals)) {
      for (const [slot, meal] of Object.entries(slots ?? {})) {
        if (!meal) continue;
        entries.push({
          date,
          task_type: 'meal',
          task_ref_id: meal.type === 'user_meal' ? meal.id : undefined,
          task_ref_type: meal.type === 'user_meal' ? 'user_meal' : undefined,
          title: meal.type === 'mock' ? meal.title : undefined,
          scheduled_start: slotDefaultTime(slot as MealSlot),
          after_milepost: slot as MealSlot,
        });
      }
    }

    for (const task of tasks) {
      entries.push({
        date: task.date,
        task_type: task.task_type ?? 'custom',
        task_ref_id: task.task_ref_id,
        task_ref_type: task.task_ref_type,
        title: task.title,
        scheduled_start: task.scheduled_start ?? '09:00',
      });
    }

    return {
      plan_start: this.planStartSignal(),
      plan_end: this.planEndSignal(),
      planning_task_id: taskId,
      entries,
      replace: replace || undefined,
      carryover_decisions: this.carryoverDecisionsSignal(),
    };
  }
}

function slotDefaultTime(slot: MealSlot): string {
  const map: Record<MealSlot, string> = {
    breakfast: '08:00',
    lunch: '12:00',
    dinner: '18:00',
    snack: '15:00',
  };
  return map[slot];
}
```

- [ ] **Step 4: Add `patchPreferences()` to `preferences.service.ts`**

```typescript
import { UpdatePreferencesRequest } from '../models/preferences';
import { Observable, tap } from 'rxjs';

// Add inside PreferencesService class:
patchPreferences(req: UpdatePreferencesRequest): Observable<UserPreferences> {
  const apiBase = this.config.getConfig().api.baseUrl;
  return this.http.patch<UserPreferences>(`${apiBase}/preferences/me`, req).pipe(
    tap(prefs => this.preferencesSignal.set(prefs))
  );
}
```

- [ ] **Step 5: Add `weekPlanService.clear()` to `auth.service.ts` logout**

Find the `logout()` method in `auth.service.ts`. Add `inject(WeekPlanService).clear()` call alongside the other service clears. Import `WeekPlanService` at the top (use `inject()` at the field level to avoid circular dependency issues — declare `private readonly weekPlanService = inject(WeekPlanService)` as a field).

- [ ] **Step 6: Run tests to confirm PASS**

```bash
just test-ng-headless
```

Expected: all WeekPlanService tests pass

- [ ] **Step 7: Commit**

```bash
git add plnd_client/src/app/core/services/week-plan.service.ts \
        plnd_client/src/app/core/services/week-plan.service.spec.ts \
        plnd_client/src/app/core/services/preferences.service.ts \
        plnd_client/src/app/core/services/auth.service.ts
git commit -m "feat(client): add WeekPlanService with signals, draft lifecycle, and API calls"
```

---

## Task 9: Frontend — Routes, Sidebar, Settings

**Files:**
- Modify: `plnd_client/src/app/app.routes.ts`
- Modify: `plnd_client/src/app/layouts/main-layout/main-layout.html`
- Modify: `plnd_client/src/app/layouts/main-layout/main-layout.ts`
- Modify: `plnd_client/src/app/features/settings/settings.ts`
- Modify: `plnd_client/src/app/features/settings/settings.spec.ts`

- [ ] **Step 1: Add `/plan/week` route to `app.routes.ts`**

Inside the authenticated layout `children` array (after the `dietary-restrictions` route):

```typescript
{
  path: 'plan',
  children: [
    {
      path: 'week',
      loadComponent: () =>
        import('./features/planning/planning-wizard/planning-wizard').then(
          m => m.PlanningWizardComponent
        )
    },
    { path: '', redirectTo: 'week', pathMatch: 'full' }
  ]
}
```

- [ ] **Step 2: Add "Plan Week" to `main-layout.html` sidebar and mobile tabs**

In the `<nav class="sidebar-nav">` block, after the "Today" link:

```html
<a routerLink="/plan/week" routerLinkActive="active"
   class="sidebar-item" aria-label="Plan Week">
  <span class="sidebar-icon" aria-hidden="true">📋</span>
  <span class="sidebar-label">Plan Week</span>
  @if (weekPlanService.hasUnplannedHorizon()) {
    <span class="sidebar-badge" aria-label="Week not yet planned"></span>
  }
</a>
```

In the `<nav class="bottom-tabs">` block, after the "Today" tab:

```html
<a routerLink="/plan/week" routerLinkActive="active"
   class="bottom-tab" aria-label="Plan Week">
  <span class="tab-icon" aria-hidden="true">📋</span>
  <span class="tab-label">Plan</span>
</a>
```

- [ ] **Step 3: Update `main-layout.ts` to inject `WeekPlanService`**

```typescript
import { WeekPlanService } from '../../core/services/week-plan.service';

// Inside MainLayoutComponent class:
readonly weekPlanService = inject(WeekPlanService);
```

- [ ] **Step 3b: Update `main-layout.spec.ts` to provide `HttpClientTestingModule`**

`WeekPlanService` uses `HttpClient`. When `MainLayoutComponent` injects it, the existing spec will fail unless `HttpClient` is provided. Read `main-layout.spec.ts` and add `HttpClientTestingModule` to the `imports` array in `configureTestingModule`. This is the same pattern used when `NavbarAvatarComponent` was added.

- [ ] **Step 4: Add 3 planning fields to `settings.ts`**

**Important:** Read `settings.ts` before making any changes. The file may have an existing `theme` FormControl and matching `<select>` in the template. Migration 0014 removed `theme` from the database but the Angular component may still reference it. If you find a `theme` control:
- Remove it from the `FormGroup`
- Remove the corresponding `<select>` from the template
- The `save()` method below replaces the entire save logic — do not call `patchPreferences({ theme: ... })`

The settings form should:

1. Load existing `preferences` on `ngOnInit` and patch the form
2. Include three new controls: `weekStartDay` (select 0–6), `planLengthDays` (number 1–90), `planningTriggerOffset` (number -14–14)
3. On save, call `preferencesService.patchPreferences({ week_start_day, default_plan_length_days, planning_trigger_offset })`

Example form group addition:
```typescript
weekStartDay: new FormControl<number>(1, { nonNullable: true, validators: [Validators.min(0), Validators.max(6)] }),
planLengthDays: new FormControl<number>(7, { nonNullable: true, validators: [Validators.min(1), Validators.max(90)] }),
planningTriggerOffset: new FormControl<number>(0, { nonNullable: true, validators: [Validators.min(-14), Validators.max(14)] }),
```

Template additions (inside the settings form):

```html
<div class="settings-section">
  <h2>Planning</h2>

  <label for="weekStartDay">Week starts on</label>
  <select id="weekStartDay" formControlName="weekStartDay">
    <option [value]="0">Sunday</option>
    <option [value]="1">Monday</option>
    <option [value]="2">Tuesday</option>
    <option [value]="3">Wednesday</option>
    <option [value]="4">Thursday</option>
    <option [value]="5">Friday</option>
    <option [value]="6">Saturday</option>
  </select>

  <label for="planLengthDays">Plan horizon length (days)</label>
  <input id="planLengthDays" type="number" min="1" max="90"
         formControlName="planLengthDays" class="settings-input" />

  <label for="planningTriggerOffset">Planning reminder (days before/after horizon start)</label>
  <input id="planningTriggerOffset" type="number" min="-14" max="14"
         formControlName="planningTriggerOffset" class="settings-input" />
</div>
```

In `save()`, update to call `patchPreferences`:
```typescript
save(): void {
  const v = this.form.getRawValue();
  this.pending = true;
  this.preferencesService.patchPreferences({
    week_start_day: v.weekStartDay,
    default_plan_length_days: v.planLengthDays,
    planning_trigger_offset: v.planningTriggerOffset,
  }).subscribe({
    next: () => { this.pending = false; },
    error: () => { this.pending = false; }
  });
}
```

- [ ] **Step 5: Add tests to `settings.spec.ts` for new fields**

```typescript
it('should render week start day select', () => {
  fixture.detectChanges();
  httpMock.expectOne(r => r.url.includes('/preferences/me') && r.method === 'GET')
    .flush({ user_id: 'u1', week_start_day: 1, planning_trigger_offset: 0,
             default_plan_length_days: 7, created_at: '', updated_at: '' });
  fixture.detectChanges();
  const select = fixture.nativeElement.querySelector('#weekStartDay');
  expect(select).toBeTruthy();
});

it('should patch preferences on save', () => {
  fixture.detectChanges();
  httpMock.expectOne(r => r.method === 'GET').flush({
    user_id: 'u1', week_start_day: 1, planning_trigger_offset: 0,
    default_plan_length_days: 7, created_at: '', updated_at: ''
  });
  fixture.detectChanges();

  const btn = fixture.nativeElement.querySelector('button[type="button"]');
  btn.click();
  const req = httpMock.expectOne(r => r.url.includes('/preferences/me') && r.method === 'PATCH');
  expect(req.request.body).toBeTruthy();
  req.flush({ user_id: 'u1', week_start_day: 1, planning_trigger_offset: 0,
              default_plan_length_days: 7, created_at: '', updated_at: '' });
});
```

- [ ] **Step 6: Run tests**

```bash
just test-ng-headless
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add plnd_client/src/app/app.routes.ts \
        plnd_client/src/app/layouts/main-layout/main-layout.html \
        plnd_client/src/app/layouts/main-layout/main-layout.ts \
        plnd_client/src/app/features/settings/settings.ts \
        plnd_client/src/app/features/settings/settings.spec.ts
git commit -m "feat(client): add planning route, sidebar nav, and settings fields"
```

---

## Task 10: Frontend — PlanningWizardComponent (Root Container)

**Files:**
- Create: `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.ts`
- Create: `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.spec.ts`

- [ ] **Step 1: Write the failing spec**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { PlanningWizardComponent } from './planning-wizard';

describe('PlanningWizardComponent', () => {
  let fixture: ComponentFixture<PlanningWizardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanningWizardComponent, HttpClientTestingModule, RouterTestingModule]
    }).compileComponents();
    fixture = TestBed.createComponent(PlanningWizardComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show a progress bar', () => {
    const bar = fixture.nativeElement.querySelector('.wizard-progress');
    expect(bar).toBeTruthy();
  });

  it('should show Back button when step > 1', () => {
    fixture.componentInstance.weekPlanService.goToStep(2);
    fixture.detectChanges();
    const back = fixture.nativeElement.querySelector('.btn-back');
    expect(back).toBeTruthy();
  });

  it('should not show Back button on step 1', () => {
    const back = fixture.nativeElement.querySelector('.btn-back');
    expect(back).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
just test-ng-headless
```

Expected: FAIL — component doesn't exist

- [ ] **Step 3: Create `planning-wizard.ts`**

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { WeekPlanService } from '../../../core/services/week-plan.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { PlanReviewStepComponent } from '../steps/plan-review-step/plan-review-step';
import { PlanTasksStepComponent } from '../steps/plan-tasks-step/plan-tasks-step';
import { PlanMealsStepComponent } from '../steps/plan-meals-step/plan-meals-step';
import { PlanDayGridStepComponent } from '../steps/plan-day-grid-step/plan-day-grid-step';
import { PlanConfirmStepComponent } from '../steps/plan-confirm-step/plan-confirm-step';

@Component({
  selector: 'app-planning-wizard',
  standalone: true,
  imports: [
    CommonModule,
    PlanReviewStepComponent,
    PlanTasksStepComponent,
    PlanMealsStepComponent,
    PlanDayGridStepComponent,
    PlanConfirmStepComponent,
  ],
  template: `
    <div class="planning-wizard">
      <header class="wizard-header">
        <h1>Plan Your Week</h1>
        <button class="btn-cancel" (click)="cancel()" type="button">Cancel</button>
      </header>

      <div class="wizard-progress" role="progressbar"
           [attr.aria-valuenow]="weekPlanService.currentStep()"
           aria-valuemin="1" aria-valuemax="5">
        @for (s of steps; track s) {
          <div class="progress-step"
               [class.active]="weekPlanService.currentStep() === s"
               [class.done]="weekPlanService.currentStep() > s">
            {{ s }}
          </div>
        }
      </div>

      <div class="wizard-content">
        @switch (weekPlanService.currentStep()) {
          @case (1) { <app-plan-review-step /> }
          @case (2) { <app-plan-tasks-step /> }
          @case (3) { <app-plan-meals-step /> }
          @case (4) { <app-plan-day-grid-step /> }
          @case (5) { <app-plan-confirm-step /> }
        }
      </div>

      <footer class="wizard-footer">
        @if (weekPlanService.currentStep() > 1) {
          <button class="btn-back" (click)="back()" type="button">Back</button>
        }
        @if (weekPlanService.currentStep() < 5) {
          <button class="btn-next" (click)="next()" type="button">Next</button>
        }
      </footer>
    </div>
  `,
  styles: [`
    .planning-wizard { display: flex; flex-direction: column; height: 100%; }
    .wizard-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem; }
    .wizard-progress { display: flex; gap: 0.5rem; padding: 0.5rem 1rem; }
    .progress-step { width: 2rem; height: 2rem; border-radius: 50%; border: 2px solid #ccc;
                     display: flex; align-items: center; justify-content: center; }
    .progress-step.active { border-color: var(--color-primary, #4a6fa5); font-weight: bold; }
    .progress-step.done { background: var(--color-primary, #4a6fa5); color: #fff; border-color: transparent; }
    .wizard-content { flex: 1; overflow-y: auto; padding: 1rem; }
    .wizard-footer { display: flex; justify-content: space-between; padding: 1rem;
                     border-top: 1px solid #eee; }
  `]
})
export class PlanningWizardComponent implements OnInit {
  readonly weekPlanService = inject(WeekPlanService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly router = inject(Router);

  readonly steps = [1, 2, 3, 4, 5];

  ngOnInit(): void {
    this.preferencesService.loadPreferences();
    const prefs = this.preferencesService.preferences();
    // Compute horizon start = next occurrence of configured week_start_day.
    // triggerOffset only controls when the "Plan your week" TASK appears
    // (handled by POST /tasks/weekly-plan) — it does NOT shift the horizon start.
    const today = new Date();
    const weekStartDay = prefs?.week_start_day ?? 1; // default Monday
    const planLengthDays = prefs?.default_plan_length_days ?? 7;

    // Days until the next occurrence of weekStartDay (minimum 1 — never today if today is that day)
    const daysUntilStart = ((weekStartDay - today.getDay()) + 7) % 7 || 7;
    const planStart = new Date(today);
    planStart.setDate(today.getDate() + daysUntilStart);
    const planEnd = new Date(planStart);
    planEnd.setDate(planStart.getDate() + planLengthDays - 1);

    this.weekPlanService.initSession(
      toIsoDate(planStart),
      toIsoDate(planEnd)
    );
  }

  next(): void {
    const step = this.weekPlanService.currentStep();
    if (step < 5) this.weekPlanService.goToStep(step + 1);
  }

  back(): void {
    const step = this.weekPlanService.currentStep();
    if (step > 1) this.weekPlanService.goToStep(step - 1);
  }

  cancel(): void {
    this.weekPlanService.clearDraft();
    this.router.navigate(['/today']);
  }
}

/** Converts a Date to ISO date string (YYYY-MM-DD) in local time, avoiding UTC-offset rollback. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

- [ ] **Step 4: Run tests**

```bash
just test-ng-headless
```

Expected: PASS — step components imported but empty stubs are acceptable at this point (create minimal stubs for each step if needed to unblock compilation)

> **Note:** Create minimal stub files for each step component if they don't exist yet:
> ```typescript
> // plan-review-step.ts (stub)
> import { Component } from '@angular/core';
> @Component({ selector: 'app-plan-review-step', standalone: true, template: '<p>Step 1</p>' })
> export class PlanReviewStepComponent {}
> ```
> Repeat for all 5 step components and `PlanDayCardComponent`.

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/features/planning/
git commit -m "feat(client): add PlanningWizardComponent with step routing and progress bar"
```

---

## Task 11: Frontend — Step 1: PlanReviewStepComponent

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.ts`
- Create: `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.spec.ts`

- [ ] **Step 1: Write the failing spec**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PlanReviewStepComponent } from './plan-review-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanReviewStepComponent', () => {
  let fixture: ComponentFixture<PlanReviewStepComponent>;
  let httpMock: HttpTestingController;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanReviewStepComponent, HttpClientTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlanReviewStepComponent);
  });

  afterEach(() => httpMock.verify());

  it('should create', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({ entries: [], carryover: [] });
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show empty state when no carryover', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({ entries: [], carryover: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nothing to carry over');
  });

  it('should show carryover items', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [],
      carryover: [{ entry_id: 'e1', title: 'Morning walk', task_type: 'custom',
                    date: '2026-03-20', status: 'planned',
                    scheduled_start: '2026-03-20T09:00:00Z' }]
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Morning walk');
  });

  it('should call setCarryoverDecision on Defer click', () => {
    spyOn(service, 'setCarryoverDecision');
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [],
      carryover: [{ entry_id: 'e1', title: 'Walk', task_type: 'custom',
                    date: '2026-03-20', status: 'planned',
                    scheduled_start: '2026-03-20T09:00:00Z' }]
    });
    fixture.detectChanges();
    const deferBtn = fixture.nativeElement.querySelector('[data-action="defer"]');
    deferBtn?.click();
    expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'defer');
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
just test-ng-headless
```

- [ ] **Step 3: Implement `plan-review-step.ts`**

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { CarryoverDecision, ScheduleEntryDto } from '../../../../core/models/week-plan';

@Component({
  selector: 'app-plan-review-step',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="plan-review">
      <h2>Review carry-over items</h2>
      <p class="subtitle">
        Planning
        <strong>{{ weekPlanService.planStart() }}</strong>
        →
        <strong>{{ weekPlanService.planEnd() }}</strong>
        <!-- TODO(phase-3): add date-range picker to allow horizon adjustment -->
      </p>

      @if (loading) {
        <p>Loading…</p>
      } @else if (weekPlanService.carryoverItems().length === 0) {
        <p class="empty-state">Nothing to carry over — you're all caught up!</p>
      } @else {
        <ul class="carryover-list">
          @for (item of weekPlanService.carryoverItems(); track item.entry_id) {
            <li class="carryover-item">
              <span class="item-title">{{ item.title ?? item.task_type }}</span>
              <span class="item-date">{{ item.date }}</span>
              <span class="item-actions">
                <button type="button" data-action="accept"
                        [class.selected]="decision(item.entry_id) === 'accept'"
                        (click)="decide(item.entry_id, 'accept')">Accept</button>
                <button type="button" data-action="defer"
                        [class.selected]="decision(item.entry_id) === 'defer'"
                        (click)="decide(item.entry_id, 'defer')">Defer</button>
                <button type="button" data-action="dismiss"
                        [class.selected]="decision(item.entry_id) === 'dismiss'"
                        (click)="decide(item.entry_id, 'dismiss')">Dismiss</button>
              </span>
            </li>
          }
        </ul>
      }
    </div>
  `
})
export class PlanReviewStepComponent implements OnInit {
  readonly weekPlanService = inject(WeekPlanService);
  loading = true;

  ngOnInit(): void {
    this.weekPlanService
      .loadPeriod(this.weekPlanService.planStart(), this.weekPlanService.planEnd())
      .subscribe({ next: () => (this.loading = false), error: () => (this.loading = false) });
  }

  decision(entryId: string): CarryoverDecision | undefined {
    return this.weekPlanService.carryoverDecisions()[entryId];
  }

  decide(entryId: string, d: CarryoverDecision): void {
    this.weekPlanService.setCarryoverDecision(entryId, d);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
just test-ng-headless
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/features/planning/steps/plan-review-step/
git commit -m "feat(client): implement Step 1 PlanReviewStepComponent (carryover decisions)"
```

---

## Task 12: Frontend — Step 2: PlanTasksStepComponent

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.ts`
- Create: `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.spec.ts`

- [ ] **Step 1: Write the failing spec**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PlanTasksStepComponent } from './plan-tasks-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanTasksStepComponent', () => {
  let fixture: ComponentFixture<PlanTasksStepComponent>;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanTasksStepComponent, HttpClientTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    fixture = TestBed.createComponent(PlanTasksStepComponent);
    fixture.detectChanges();
  });

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should render one row per horizon day', () => {
    const rows = fixture.nativeElement.querySelectorAll('.day-tasks-row');
    expect(rows.length).toBe(7);
  });

  it('should add task when form is submitted', () => {
    spyOn(service, 'addTask');
    const comp = fixture.componentInstance;
    comp.addTaskForm.setValue({ date: '2026-03-24', title: 'Walk', energy: 'low', duration: 30 });
    comp.submitAddTask();
    expect(service.addTask).toHaveBeenCalledWith(
      jasmine.objectContaining({ date: '2026-03-24', title: 'Walk', energy: 'low' })
    );
  });
});
```

- [ ] **Step 2: Implement `plan-tasks-step.ts`**

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { EnergyLevel } from '../../../../core/models/week-plan';

@Component({
  selector: 'app-plan-tasks-step',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="plan-tasks">
      <h2>Tasks &amp; Exercise</h2>

      @for (day of horizonDays; track day) {
        <div class="day-tasks-row">
          <h3>{{ day }}</h3>
          <ul>
            @for (task of tasksForDay(day); track $index) {
              <li class="task-item">
                <span class="task-energy energy-{{ task.energy }}">●</span>
                {{ task.title }}
                <button type="button" (click)="removeTask(day, $index)">✕</button>
              </li>
            }
          </ul>
        </div>
      }

      <form [formGroup]="addTaskForm" class="add-task-form">
        <h3>Add a task or exercise</h3>
        <select formControlName="date">
          @for (day of horizonDays; track day) {
            <option [value]="day">{{ day }}</option>
          }
        </select>
        <input formControlName="title" placeholder="Task name" />
        <select formControlName="energy">
          <option value="low">Low energy</option>
          <option value="medium">Medium energy</option>
          <option value="high">High energy</option>
        </select>
        <input formControlName="duration" type="number" placeholder="Minutes (optional)" />
        <button type="button" (click)="submitAddTask()"
                [disabled]="addTaskForm.invalid">Add</button>
      </form>
    </div>
  `
})
export class PlanTasksStepComponent implements OnInit {
  readonly weekPlanService = inject(WeekPlanService);
  horizonDays: string[] = [];

  readonly addTaskForm = new FormGroup({
    date: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    title: new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    energy: new FormControl<EnergyLevel>('medium', { nonNullable: true }),
    duration: new FormControl<number | null>(null),
  });

  ngOnInit(): void {
    this.horizonDays = this.weekPlanService.horizonDays();
    if (this.horizonDays.length) {
      this.addTaskForm.patchValue({ date: this.horizonDays[0] });
    }
  }

  tasksForDay(date: string) {
    return this.weekPlanService.scheduledTasks().filter(t => t.date === date);
  }

  removeTask(date: string, localIndex: number): void {
    const globalIndex = this.weekPlanService.scheduledTasks()
      .findIndex((t, i) => t.date === date &&
        this.weekPlanService.scheduledTasks().filter(x => x.date === date).indexOf(t) === localIndex);
    if (globalIndex >= 0) this.weekPlanService.removeTask(globalIndex);
  }

  submitAddTask(): void {
    if (this.addTaskForm.invalid) return;
    const v = this.addTaskForm.getRawValue();
    this.weekPlanService.addTask({
      date: v.date,
      title: v.title,
      energy: v.energy,
      duration: v.duration ?? undefined,
      task_type: 'custom',
    });
    this.addTaskForm.patchValue({ title: '', duration: null });
  }
}
```

- [ ] **Step 3: Run tests**

```bash
just test-ng-headless
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add plnd_client/src/app/features/planning/steps/plan-tasks-step/
git commit -m "feat(client): implement Step 2 PlanTasksStepComponent"
```

---

## Task 13: Frontend — Step 3: PlanMealsStepComponent

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts`
- Create: `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.spec.ts`

- [ ] **Step 1: Write the failing spec**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PlanMealsStepComponent } from './plan-meals-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanMealsStepComponent', () => {
  let fixture: ComponentFixture<PlanMealsStepComponent>;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanMealsStepComponent, HttpClientTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    fixture = TestBed.createComponent(PlanMealsStepComponent);
    fixture.detectChanges();
  });

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should show meal slots for each day', () => {
    const slots = fixture.nativeElement.querySelectorAll('.meal-slot');
    // 7 days × 3 slots (B/L/D) = 21 minimum
    expect(slots.length).toBeGreaterThanOrEqual(21);
  });

  it('should pre-populate mock suggestions', () => {
    const firstSuggestion = fixture.nativeElement.querySelector('.meal-suggestion');
    expect(firstSuggestion?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('should call setMeal when Accept is clicked', () => {
    spyOn(service, 'setMeal');
    const acceptBtn = fixture.nativeElement.querySelector('[data-action="accept"]');
    acceptBtn?.click();
    expect(service.setMeal).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `plan-meals-step.ts`**

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { MealSlot, PlannedMeal, getMockSuggestion } from '../../../../core/models/week-plan';

const STANDARD_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

@Component({
  selector: 'app-plan-meals-step',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="plan-meals">
      <h2>Meals</h2>
      <p class="subtitle">Suggestions are placeholders — accept, swap, or skip each slot.</p>

      @for (day of horizonDays; track day) {
        <div class="day-meals">
          <h3>{{ day }}</h3>
          @for (slot of slots; track slot) {
            <div class="meal-slot">
              <span class="slot-label">{{ slot | titlecase }}</span>
              @if (getMeal(day, slot); as meal) {
                <span class="meal-suggestion accepted">{{ meal.title }}</span>
                <button type="button" (click)="clearSlot(day, slot)">✕ Skip</button>
              } @else {
                <span class="meal-suggestion">{{ suggestion(day, slot) }}</span>
                <button type="button" data-action="accept"
                        (click)="accept(day, slot)">Accept</button>
                <button type="button" (click)="clearSlot(day, slot)">Skip</button>
              }
            </div>
          }
        </div>
      }
    </div>
  `
})
export class PlanMealsStepComponent implements OnInit {
  readonly weekPlanService = inject(WeekPlanService);
  readonly slots = STANDARD_SLOTS;
  horizonDays: string[] = [];

  ngOnInit(): void {
    this.horizonDays = this.weekPlanService.horizonDays();
  }

  suggestion(date: string, slot: MealSlot): string {
    return getMockSuggestion(date, slot);
  }

  getMeal(date: string, slot: MealSlot): PlannedMeal | undefined {
    return this.weekPlanService.scheduledMeals()[date]?.[slot];
  }

  accept(date: string, slot: MealSlot): void {
    this.weekPlanService.setMeal(date, slot, {
      type: 'mock',
      title: getMockSuggestion(date, slot),
    });
  }

  clearSlot(date: string, slot: MealSlot): void {
    this.weekPlanService.clearMeal(date, slot);
  }
}
```

- [ ] **Step 3: Run tests**

```bash
just test-ng-headless
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add plnd_client/src/app/features/planning/steps/plan-meals-step/
git commit -m "feat(client): implement Step 3 PlanMealsStepComponent with mock suggestions"
```

---

## Task 14: Frontend — Step 4: PlanDayGridStepComponent + PlanDayCardComponent

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-grid-step.ts`
- Modify: `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.ts`
- Create: `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-grid-step.spec.ts`

- [ ] **Step 1: Write the failing spec**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PlanDayGridStepComponent } from './plan-day-grid-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanDayGridStepComponent', () => {
  let fixture: ComponentFixture<PlanDayGridStepComponent>;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanDayGridStepComponent, HttpClientTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    fixture = TestBed.createComponent(PlanDayGridStepComponent);
    fixture.detectChanges();
  });

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should render 7 day cards', () => {
    const cards = fixture.nativeElement.querySelectorAll('app-plan-day-card');
    expect(cards.length).toBe(7);
  });
});
```

- [ ] **Step 2: Implement `plan-day-card.ts`**

```typescript
import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

@Component({
  selector: 'app-plan-day-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="day-card" [class.expanded]="expanded" (click)="toggle()">
      <div class="card-header">
        <strong>{{ date }}</strong>
        <span class="task-count">{{ taskCount }} task(s)</span>
        <span class="meal-count">{{ mealCount }} meal(s)</span>
      </div>
      @if (expanded) {
        <div class="card-body">
          <h4>Meals</h4>
          <ul>
            @for (slot of slots; track slot) {
              @if (getMeal(slot); as meal) {
                <li>{{ slot | titlecase }}: {{ meal.title }}</li>
              } @else {
                <li class="empty-slot">{{ slot | titlecase }}: — </li>
              }
            }
          </ul>
          <h4>Tasks</h4>
          <ul>
            @for (task of tasks; track $index) {
              <li>{{ task.title }} ({{ task.energy }})</li>
            }
          </ul>
        </div>
      }
    </div>
  `
})
export class PlanDayCardComponent {
  @Input({ required: true }) date!: string;

  private readonly weekPlanService = inject(WeekPlanService);
  expanded = false;
  readonly slots = ['breakfast', 'lunch', 'dinner'] as const;

  toggle(): void { this.expanded = !this.expanded; }

  get tasks() { return this.weekPlanService.scheduledTasks().filter(t => t.date === this.date); }
  get taskCount() { return this.tasks.length; }
  getMeal(slot: string) { return this.weekPlanService.scheduledMeals()[this.date]?.[slot as any]; }
  get mealCount() { return this.slots.filter(s => this.getMeal(s)).length; }
}
```

- [ ] **Step 3: Implement `plan-day-grid-step.ts`**

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { PlanDayCardComponent } from './plan-day-card';

@Component({
  selector: 'app-plan-day-grid-step',
  standalone: true,
  imports: [CommonModule, PlanDayCardComponent],
  template: `
    <div class="plan-day-grid">
      <h2>Day Review</h2>
      <p class="subtitle">Review each day. Tap a card to expand and edit.</p>
      <div class="day-grid">
        @for (day of horizonDays; track day) {
          <app-plan-day-card [date]="day" />
        }
      </div>
    </div>
  `,
  styles: [`
    .day-grid { display: flex; flex-wrap: wrap; gap: 1rem; }
    @media (max-width: 600px) {
      .day-grid { flex-direction: column; overflow-x: auto; flex-wrap: nowrap; }
    }
  `]
})
export class PlanDayGridStepComponent implements OnInit {
  private readonly weekPlanService = inject(WeekPlanService);
  horizonDays: string[] = [];

  ngOnInit(): void {
    this.horizonDays = this.weekPlanService.horizonDays();
  }
}
```

- [ ] **Step 4: Run tests**

```bash
just test-ng-headless
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/features/planning/steps/plan-day-grid-step/
git commit -m "feat(client): implement Step 4 PlanDayGridStepComponent + PlanDayCardComponent"
```

---

## Task 15: Frontend — Step 5: PlanConfirmStepComponent

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.ts`
- Create: `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.spec.ts`

- [ ] **Step 1: Write the failing spec**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { PlanConfirmStepComponent } from './plan-confirm-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanConfirmStepComponent', () => {
  let fixture: ComponentFixture<PlanConfirmStepComponent>;
  let httpMock: HttpTestingController;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanConfirmStepComponent, HttpClientTestingModule, RouterTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlanConfirmStepComponent);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should show Finish Week Plan button', () => {
    const btn = fixture.nativeElement.querySelector('.btn-finish');
    expect(btn).toBeTruthy();
  });

  it('should show summary stats', () => {
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('7'); // 7 days planned
  });

  it('should call commitPlan on finish click', () => {
    const { of } = require('rxjs');
    spyOn(service, 'commitPlan').and.returnValue(
      of({ committed: 0, planning_task_status: 'completed' })
    );
    fixture.componentInstance.planningTaskId = 'task-uuid';
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-finish');
    btn.click();
    expect(service.commitPlan).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `plan-confirm-step.ts`**

```typescript
import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

@Component({
  selector: 'app-plan-confirm-step',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="plan-confirm">
      <h2>Confirm Your Plan</h2>

      <div class="summary-stats">
        <div class="stat">
          <span class="stat-value">{{ totalDays }}</span>
          <span class="stat-label">Days planned</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ mealCoverage }}%</span>
          <span class="stat-label">Meal coverage</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ taskCount }}</span>
          <span class="stat-label">Tasks</span>
        </div>
      </div>

      @if (errorMessage) {
        <p class="error-message" role="alert">{{ errorMessage }}</p>
      }

      <button class="btn-finish"
              type="button"
              [disabled]="weekPlanService.isSubmitting()"
              (click)="finish()">
        @if (weekPlanService.isSubmitting()) {
          Saving…
        } @else {
          Finish Week Plan
        }
      </button>
    </div>
  `
})
export class PlanConfirmStepComponent implements OnInit {
  @Input() planningTaskId = '';

  readonly weekPlanService = inject(WeekPlanService);
  private readonly router = inject(Router);

  errorMessage = '';
  totalDays = 0;
  mealCoverage = 0;
  taskCount = 0;

  ngOnInit(): void {
    const days = this.weekPlanService.horizonDays();
    this.totalDays = days.length;
    this.taskCount = this.weekPlanService.scheduledTasks().length;

    const meals = this.weekPlanService.scheduledMeals();
    const filledSlots = days.reduce((acc, d) => {
      const daySlots = meals[d] ?? {};
      return acc + ['breakfast', 'lunch', 'dinner'].filter(s => daySlots[s as any]).length;
    }, 0);
    this.mealCoverage = days.length > 0
      ? Math.round((filledSlots / (days.length * 3)) * 100)
      : 0;
  }

  finish(): void {
    this.errorMessage = '';
    this.weekPlanService.commitPlan(this.planningTaskId).subscribe({
      next: () => {
        this.router.navigate(['/day', this.weekPlanService.planStart()]);
      },
      error: () => {
        this.errorMessage = 'Failed to save plan — please try again.';
      },
    });
  }
}
```

- [ ] **Step 3: Run tests**

```bash
just test-ng-headless
```

Expected: PASS

- [ ] **Step 4: Run full test suite**

```bash
just test-ci
```

Expected: PASS — all Rust and Angular tests

- [ ] **Step 5: Run quality checks**

```bash
just verify
```

Expected: all checks pass cleanly

- [ ] **Step 6: Commit**

```bash
git add plnd_client/src/app/features/planning/steps/plan-confirm-step/
git commit -m "feat(client): implement Step 5 PlanConfirmStepComponent + commit to backend"
```

---

## Final Step: Open PR

- [ ] **Push branch and open PR**

```bash
git push -u origin <your-branch-name>
gh pr create \
  --title "feat: weekly planning wizard (Phase 2.5)" \
  --body "Implements the weekly planning wizard per spec: 5-step guided session for scheduling meals and tasks for the coming week. Includes backend endpoints, Angular wizard components, localStorage draft persistence, and settings page updates."
```

---

## Verification Checklist (from spec)

- [ ] Navigate to day view on `plan_start + planning_trigger_offset` — "Plan your week" task appears
- [ ] Tap the task → wizard loads at `/plan/week`, Step 1 shows
- [ ] Adjust horizon dates in Step 1 → range persists throughout wizard
- [ ] Complete all 5 steps — localStorage draft written after each step
- [ ] Click "Finish Week Plan" → `POST /schedule/plan` fires, navigates to day view
- [ ] Navigate to `/plan/week` again → wizard detects existing plan (badge clear)
- [ ] Sidebar "Plan Week" badge shows when horizon unplanned; clears after commit
- [ ] Settings page → change `week_start_day` → new sessions respect the updated default
- [ ] Crash recovery: fill steps 1–3, close browser, reopen → wizard resumes at step 3
