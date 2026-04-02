# DB Layer Migration: plnd_api → plnd_data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all database access logic from `plnd_api/src/db/` into `plnd_data/src/db/` so that `plnd_data` owns all data-at-rest concerns, enabling `plnd_agent` (Phase 3) to depend on `plnd_data` without pulling in HTTP/auth/utoipa concerns.

**Architecture:** All 15 DB modules move to `plnd_data/src/db/`. `utoipa::ToSchema` is stripped from every moved type. Two DB query functions (`preferences::patch_preferences`, `schedule::commit_plan`) are decoupled from HTTP request types by changing signatures to take individual fields or a new `plnd_data`-internal input struct. Three API response wrapper types (`UserResponse`, `UserPreferencesResponse`, `DietaryRestrictionResponse`) are created in `plnd_api` with `From<>` impls and `ToSchema`. `#[utoipa::path]` annotations are removed from routes not registered in `openapi.rs` to avoid dead ToSchema requirements.

**Tech Stack:** Rust, SQLx 0.8 (postgres, uuid, chrono, runtime-tokio, migrate, json, rust_decimal), utoipa 5 (plnd_api only), Axum 0.8

---

## File Map

**New files:**
- `plnd_data/src/db/mod.rs`
- `plnd_data/src/db/error.rs`
- `plnd_data/src/db/connection.rs`
- `plnd_data/src/db/models.rs`
- `plnd_data/src/db/briefing.rs`
- `plnd_data/src/db/catalog_details.rs`
- `plnd_data/src/db/catalog_ingest.rs`
- `plnd_data/src/db/dietary_restrictions.rs`
- `plnd_data/src/db/preferences.rs`
- `plnd_data/src/db/schedule.rs`
- `plnd_data/src/db/search.rs`
- `plnd_data/src/db/tasks.rs`
- `plnd_data/src/db/user_dish_prefs.rs`
- `plnd_data/src/db/user_ingredient_prefs.rs`
- `plnd_data/src/db/user_meal_prefs.rs`
- `plnd_data/src/db/users.rs`
- `plnd_api/src/models.rs` — HTTP request/response types (from old `db/models/mod.rs`)
- `plnd_api/src/api_response.rs` — API response wrappers with `ToSchema`

**Modified files:**
- `plnd_data/Cargo.toml` — add sqlx + related deps
- `plnd_data/src/lib.rs` — add `pub mod db;`
- `plnd_api/Cargo.toml` — remove `sqlx` direct dep
- `plnd_api/src/lib.rs` — remove `pub mod db;`, add `pub mod models;`, `pub mod api_response;`
- `plnd_api/src/state.rs` — import `Database` from `plnd_data`
- `plnd_api/src/openapi.rs` — swap model imports for wrapper types
- `plnd_api/src/routes/users.rs`
- `plnd_api/src/routes/dietary_restrictions.rs`
- `plnd_api/src/routes/preferences.rs`
- `plnd_api/src/routes/system.rs`
- `plnd_api/src/routes/schedule.rs`
- `plnd_api/src/routes/tasks.rs`
- `plnd_api/src/routes/search.rs`
- `plnd_api/src/routes/catalog_details.rs`
- `plnd_api/src/routes/catalog_ingest.rs`
- `plnd_api/src/routes/user_dish_prefs.rs`
- `plnd_api/src/routes/user_ingredient_prefs.rs`
- `plnd_api/src/routes/user_meal_prefs.rs`
- `plnd_api/src/routes/auth.rs`

**Deleted:**
- `plnd_api/src/db/` (entire directory — 16 files)

---

## Task 1: Add SQLx deps to plnd_data and scaffold the db module

**Files:**
- Modify: `plnd_data/Cargo.toml`
- Modify: `plnd_data/src/lib.rs`
- Create: `plnd_data/src/db/mod.rs`

- [ ] **Step 1: Add SQLx and related deps to plnd_data/Cargo.toml**

Open `plnd_data/Cargo.toml` and add these entries under `[dependencies]` (after the existing entries):

```toml
chrono = { version = "0.4", features = ["serde"] }
rust_decimal = { version = "1", features = ["db-postgres"] }
sqlx = { version = "0.8", features = ["postgres", "uuid", "chrono", "runtime-tokio", "migrate", "json", "rust_decimal"] }
uuid = { version = "1", features = ["v4", "serde"] }
```

- [ ] **Step 2: Create the db module stub**

Create `plnd_data/src/db/mod.rs`:

```rust
pub mod connection;
pub mod error;
pub mod models;

pub mod briefing;
pub mod catalog_details;
pub mod catalog_ingest;
pub mod dietary_restrictions;
pub mod preferences;
pub mod schedule;
pub mod search;
pub mod tasks;
pub mod user_dish_prefs;
pub mod user_ingredient_prefs;
pub mod user_meal_prefs;
pub mod users;

pub use connection::Database;
```

- [ ] **Step 3: Add db to plnd_data's lib.rs**

Edit `plnd_data/src/lib.rs` to add `pub mod db;`:

```rust
pub mod cache;
pub mod db;
pub mod providers;
pub mod search;
```

- [ ] **Step 4: Verify plnd_data fails to compile with missing modules (expected)**

```bash
just verify-build 2>&1 | head -20
```

Expected: compile errors for missing db submodules. That's correct — we'll create them next.

---

## Task 2: Move error.rs and connection.rs to plnd_data

**Files:**
- Create: `plnd_data/src/db/error.rs`
- Create: `plnd_data/src/db/connection.rs`

These are verbatim copies — the internal import paths (`crate::db::error`) are unchanged since we're still inside the same crate (now `plnd_data`).

- [ ] **Step 1: Create plnd_data/src/db/error.rs**

```rust
use thiserror::Error;

#[derive(Debug, Error)]
#[allow(clippy::enum_variant_names)]
pub enum DatabaseError {
    #[error("Database connection failed: {0}")]
    ConnectionError(String),

    #[error("Database query failed: {0}")]
    QueryError(String),

    #[error("Validation error: {0}")]
    ValidationError(String),

    #[allow(dead_code)]
    #[error("Migration failed: {0}")]
    MigrationError(String),

    #[allow(dead_code)]
    #[error("Database configuration error: {0}")]
    ConfigurationError(String),
}

impl From<sqlx::Error> for DatabaseError {
    fn from(error: sqlx::Error) -> Self {
        DatabaseError::ConnectionError(error.to_string())
    }
}
```

- [ ] **Step 2: Create plnd_data/src/db/connection.rs**

```rust
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

use crate::db::error::DatabaseError;

#[derive(Clone)]
pub struct Database {
    pool: PgPool,
}

impl Database {
    /// Create a new database connection pool
    pub async fn new(database_url: &str, max_connections: u32) -> Result<Self, DatabaseError> {
        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .acquire_timeout(Duration::from_secs(30))
            .idle_timeout(Duration::from_secs(600))
            .connect(database_url)
            .await
            .map_err(|e| DatabaseError::ConnectionError(e.to_string()))?;

        Ok(Database { pool })
    }

    /// Get a reference to the connection pool
    #[allow(dead_code)]
    pub fn get_pool(&self) -> &PgPool {
        &self.pool
    }

    /// Health check - verify database connectivity
    pub async fn health_check(&self) -> Result<(), DatabaseError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|e| DatabaseError::QueryError(e.to_string()))
    }
}
```

- [ ] **Step 3: Verify plnd_data compiles with error + connection**

```bash
just verify-build 2>&1 | grep "plnd_data"
```

Expected: errors for missing `models`, `briefing`, etc. — but no errors in `error.rs` or `connection.rs`.

---

## Task 3: Create plnd_data/src/db/models.rs

**Files:**
- Create: `plnd_data/src/db/models.rs`

This file contains all `sqlx::FromRow` types from `plnd_api/src/db/models/mod.rs` PLUS the schedule result types and input types needed for DB function decoupling. All `utoipa::ToSchema` derives are stripped.

**Types from models/mod.rs that move here** (strip `utoipa::ToSchema` and `utoipa` import):
- `UserPreferences`, `DietaryRestriction`, `User`
- All catalog types: `CatalogIngredient`, `CatalogDish`, `CatalogDishIngredient`, `CatalogMeal`, `CatalogMealDish`
- All user library types: `UserDish`, `UserDishIngredient`, `UserMeal`, `UserMealDish`
- Preference aggregates: `UserDishPref`, `UserDishPrefDetail`, `UserMealPref`, `UserMealPrefDetail`, `UserIngredientPref`
- Exercise types: `CatalogExercise`, `UserExercise`
- Family types: `Family`, `FamilyMember`, `FamilyMeal`
- Task types: `Task`, `MealTask`, `ExerciseTask`, `WorkTask`, `GenericTask`
- Schedule types: `ScheduleTemplate`, `ScheduleEntry`

**Types that move here from models/mod.rs and are also used by schedule.rs** (strip utoipa):
- `SchedulePeriodResponse` — DB query result, stays as `{ entries: Vec<ScheduleEntry>, carryover: Vec<ScheduleEntry> }`
- `PlanStatusResponse` — DB query result, stays as `{ planned: bool, entry_count: i64 }`
- `PostSchedulePlanResponse` — DB return type, stays as `{ committed: i64, planning_task_status: String }`

**New types created here** (for decoupling `schedule::commit_plan` from HTTP types):
- `CarryoverDecision` — enum matching the old HTTP version, but without utoipa
- `CommitPlanInput` — mirrors `PostSchedulePlanRequest` fields used by the DB function
- `PlanEntryInput` — mirrors the fields of `PlanEntryRequest` used by the DB function

- [ ] **Step 1: Create plnd_data/src/db/models.rs**

Copy the file content from `plnd_api/src/db/models/mod.rs`, then apply these changes:

1. Change the top imports — remove `utoipa` usage, keep the rest:
```rust
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;
```

2. On every struct/enum that has `utoipa::ToSchema` in its derive list, remove it. For example:
```rust
// Before:
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct User { ... }

// After:
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User { ... }
```

3. Remove `SchedulePeriodResponse`, `PlanStatusResponse`, `PostSchedulePlanResponse`, `CarryoverDecision`, `PatchPreferencesRequest`, `PlanEntryRequest`, `PostSchedulePlanRequest`, `ReadyStatus`, `deserialize_hhmm` from this file — these are handled separately below or stay in plnd_api.

4. After all moved types, append the following new types at the end of the file:

```rust
// ---------------------------------------------------------------------------
// Schedule result types (returned by DB query functions)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulePeriodResponse {
    pub entries: Vec<ScheduleEntry>,
    pub carryover: Vec<ScheduleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStatusResponse {
    pub planned: bool,
    pub entry_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostSchedulePlanResponse {
    pub committed: i64,
    pub planning_task_status: String,
}

// ---------------------------------------------------------------------------
// Schedule commit input (DB-layer types, decoupled from HTTP request types)
// ---------------------------------------------------------------------------

/// Mirrors CarryoverDecision from plnd_api — without utoipa.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CarryoverDecision {
    Accept,
    Defer,
    Dismiss,
}

/// Input to `schedule::commit_plan` — constructed from the HTTP request in plnd_api.
#[derive(Debug, Clone)]
pub struct CommitPlanInput {
    pub plan_start: NaiveDate,
    pub plan_end: NaiveDate,
    pub planning_task_id: Uuid,
    pub entries: Vec<PlanEntryInput>,
    pub replace: bool,
    pub carryover_decisions: HashMap<Uuid, CarryoverDecision>,
}

/// One schedule entry to be committed, decoded from HTTP in plnd_api.
#[derive(Debug, Clone)]
pub struct PlanEntryInput {
    pub date: NaiveDate,
    pub task_type: String,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub title: Option<String>,
    pub scheduled_start: NaiveTime,
    pub after_milepost: Option<String>,
}
```

- [ ] **Step 2: Verify plnd_data compiles with models**

```bash
just verify-build 2>&1 | grep "plnd_data"
```

Expected: errors for missing `briefing`, `catalog_details`, etc. — but no errors in `models.rs`.

---

## Task 4: Move the 10 simple query modules to plnd_data

**Files (create each):**
- `plnd_data/src/db/briefing.rs`
- `plnd_data/src/db/catalog_details.rs`
- `plnd_data/src/db/catalog_ingest.rs`
- `plnd_data/src/db/dietary_restrictions.rs`
- `plnd_data/src/db/search.rs`
- `plnd_data/src/db/tasks.rs`
- `plnd_data/src/db/user_dish_prefs.rs`
- `plnd_data/src/db/user_ingredient_prefs.rs`
- `plnd_data/src/db/user_meal_prefs.rs`
- `plnd_data/src/db/users.rs`

These 10 files are copied verbatim from `plnd_api/src/db/` with two mechanical changes:
1. Strip `utoipa::ToSchema` from any structs defined within the file (e.g. `YesterdaySnapshot` in `briefing.rs`)
2. Imports are already correct since `crate::db::error` and `crate::db::models` still resolve the same way within `plnd_data`

- [ ] **Step 1: Copy briefing.rs — strip utoipa from YesterdaySnapshot**

Create `plnd_data/src/db/briefing.rs` from `plnd_api/src/db/briefing.rs`. Change the struct derive:

```rust
// Before:
#[derive(Debug, Serialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct YesterdaySnapshot {

// After:
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct YesterdaySnapshot {
```

Everything else in the file is unchanged.

- [ ] **Step 2: Copy catalog_details.rs, catalog_ingest.rs, dietary_restrictions.rs, search.rs, tasks.rs, user_dish_prefs.rs, user_ingredient_prefs.rs, user_meal_prefs.rs, users.rs**

For each file: copy from `plnd_api/src/db/<name>.rs` to `plnd_data/src/db/<name>.rs` verbatim. None of these files define their own structs with utoipa — they only import types from `crate::db::models` (which we already stripped). No content changes needed.

To copy all at once:
```bash
for f in catalog_details catalog_ingest dietary_restrictions search tasks user_dish_prefs user_ingredient_prefs user_meal_prefs users; do
  cp plnd_api/src/db/${f}.rs plnd_data/src/db/${f}.rs
done
```

- [ ] **Step 3: Verify plnd_data compiles (except preferences + schedule)**

```bash
just verify-build 2>&1 | grep "plnd_data"
```

Expected: errors only for missing `preferences` and `schedule` submodules.

---

## Task 5: Move preferences.rs and schedule.rs with decoupled signatures

**Files:**
- Create: `plnd_data/src/db/preferences.rs`
- Create: `plnd_data/src/db/schedule.rs`

### preferences.rs

The function currently takes `&PatchPreferencesRequest`. Change to accept the 4 optional fields directly.

- [ ] **Step 1: Create plnd_data/src/db/preferences.rs**

```rust
use chrono::NaiveTime;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::UserPreferences;

/// Upsert preferences: creates the row with defaults if absent, then applies any provided fields.
pub async fn patch_preferences(
    pool: &PgPool,
    user_id: Uuid,
    week_start_day: Option<i16>,
    planning_trigger_offset: Option<i16>,
    default_plan_length_days: Option<i16>,
    wake_time: Option<NaiveTime>,
) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences
           (user_id, week_start_day, planning_trigger_offset, default_plan_length_days, wake_time)
         VALUES ($1, COALESCE($2, 1), COALESCE($3, 0), COALESCE($4, 7), COALESCE($5, '07:00'))
         ON CONFLICT (user_id) DO UPDATE
           SET week_start_day           = COALESCE($2, user_preferences.week_start_day),
               planning_trigger_offset  = COALESCE($3, user_preferences.planning_trigger_offset),
               default_plan_length_days = COALESCE($4, user_preferences.default_plan_length_days),
               wake_time                = COALESCE($5, user_preferences.wake_time),
               updated_at               = NOW()
         RETURNING user_id, week_start_day, planning_trigger_offset,
                   default_plan_length_days, wake_time, created_at, updated_at",
    )
    .bind(user_id)
    .bind(week_start_day)
    .bind(planning_trigger_offset)
    .bind(default_plan_length_days)
    .bind(wake_time)
    .fetch_one(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}

/// Get preferences for a user, creating a default row if none exists.
pub async fn get_or_create(pool: &PgPool, user_id: Uuid) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE
           SET updated_at = user_preferences.updated_at
         RETURNING user_id, week_start_day, planning_trigger_offset,
                   default_plan_length_days, wake_time, created_at, updated_at",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}
```

### schedule.rs

The function currently takes `&PostSchedulePlanRequest`. Change to take `&CommitPlanInput` and use `PlanEntryInput`/`CarryoverDecision` from `crate::db::models`.

- [ ] **Step 2: Create plnd_data/src/db/schedule.rs**

```rust
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::{
    CarryoverDecision, CommitPlanInput, PlanStatusResponse, PostSchedulePlanResponse,
    ScheduleEntry, SchedulePeriodResponse,
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
    req: &CommitPlanInput,
) -> Result<PostSchedulePlanResponse, DatabaseError> {
    let today = chrono::Utc::now().date_naive();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

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
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

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
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
    }

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
        .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
    }

    sqlx::query(
        "UPDATE tasks SET status = 'completed', updated_at = NOW()
         WHERE task_id = $1 AND user_id = $2",
    )
    .bind(req.planning_task_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))?;

    for (entry_id, decision) in &req.carryover_decisions {
        match decision {
            CarryoverDecision::Accept => {
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
                .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
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
                .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
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
                .map_err(|e| DatabaseError::QueryError(e.to_string()))?;
            }
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
```

- [ ] **Step 3: Verify plnd_data compiles cleanly**

```bash
just verify-build 2>&1 | grep -E "error\[|warning\[" | grep "plnd_data" | head -20
```

Expected: no errors in plnd_data. plnd_api will still compile fine — it still has its own `db/` directory.

- [ ] **Step 4: Commit**

```bash
git checkout -b refactor/issue-158-db-to-plnd-data
git add plnd_data/
git commit -m "feat(plnd_data): add DB layer — move plnd_api/src/db/ to plnd_data/src/db/ (#158)"
```

---

## Task 6: Create plnd_api/src/models.rs and plnd_api/src/api_response.rs

**Files:**
- Create: `plnd_api/src/models.rs`
- Create: `plnd_api/src/api_response.rs`
- Modify: `plnd_api/src/lib.rs`

- [ ] **Step 1: Create plnd_api/src/models.rs**

This holds the HTTP-specific types that were in `plnd_api/src/db/models/mod.rs` — the types that stay in `plnd_api`. Copy these exact types from `plnd_api/src/db/models/mod.rs` into `models.rs`:

```rust
use chrono::{NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

#[derive(Serialize, utoipa::ToSchema)]
pub struct ReadyStatus {
    pub status: String,
    pub database: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

fn deserialize_hhmm<'de, D>(deserializer: D) -> Result<NaiveTime, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    NaiveTime::parse_from_str(&s, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(&s, "%H:%M:%S"))
        .map_err(serde::de::Error::custom)
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PatchPreferencesRequest {
    pub week_start_day: Option<i16>,
    pub planning_trigger_offset: Option<i16>,
    pub default_plan_length_days: Option<i16>,
    pub wake_time: Option<NaiveTime>,
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PlanEntryRequest {
    pub date: NaiveDate,
    pub task_type: String,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub title: Option<String>,
    /// UTC wall-clock time as "HH:MM" or "HH:MM:SS"
    #[serde(deserialize_with = "deserialize_hhmm")]
    pub scheduled_start: NaiveTime,
    pub after_milepost: Option<String>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum CarryoverDecision {
    Accept,
    Defer,
    Dismiss,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PostSchedulePlanRequest {
    pub plan_start: NaiveDate,
    pub plan_end: NaiveDate,
    pub planning_task_id: Uuid,
    pub entries: Vec<PlanEntryRequest>,
    pub replace: Option<bool>,
    #[serde(default)]
    pub carryover_decisions: HashMap<Uuid, CarryoverDecision>,
}
```

- [ ] **Step 2: Create plnd_api/src/api_response.rs**

These wrapper types add `ToSchema` to the DB row types that live in `plnd_data`.

```rust
use plnd_data::db::models::{DietaryRestriction, User, UserPreferences};
use serde::Serialize;

/// API response wrapper for `plnd_data::db::models::User`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UserResponse {
    pub user_id: uuid::Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub is_active: bool,
    pub last_login: Option<chrono::DateTime<chrono::Utc>>,
    pub avatar_url: Option<String>,
    pub onboarding_completed: bool,
}

impl From<User> for UserResponse {
    fn from(u: User) -> Self {
        Self {
            user_id: u.user_id,
            email: u.email,
            display_name: u.display_name,
            created_at: u.created_at,
            updated_at: u.updated_at,
            is_active: u.is_active,
            last_login: u.last_login,
            avatar_url: u.avatar_url,
            onboarding_completed: u.onboarding_completed,
        }
    }
}

/// API response wrapper for `plnd_data::db::models::UserPreferences`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UserPreferencesResponse {
    pub user_id: uuid::Uuid,
    pub week_start_day: i16,
    pub planning_trigger_offset: i16,
    pub default_plan_length_days: i16,
    pub wake_time: chrono::NaiveTime,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<UserPreferences> for UserPreferencesResponse {
    fn from(p: UserPreferences) -> Self {
        Self {
            user_id: p.user_id,
            week_start_day: p.week_start_day,
            planning_trigger_offset: p.planning_trigger_offset,
            default_plan_length_days: p.default_plan_length_days,
            wake_time: p.wake_time,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}

/// API response wrapper for `plnd_data::db::models::DietaryRestriction`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DietaryRestrictionResponse {
    pub restriction_id: uuid::Uuid,
    pub user_id: uuid::Uuid,
    pub restriction_type: String,
    pub name: String,
    pub notes: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<DietaryRestriction> for DietaryRestrictionResponse {
    fn from(r: DietaryRestriction) -> Self {
        Self {
            restriction_id: r.restriction_id,
            user_id: r.user_id,
            restriction_type: r.restriction_type,
            name: r.name,
            notes: r.notes,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}
```

- [ ] **Step 3: Add modules to plnd_api/src/lib.rs**

```rust
pub mod api_response;
pub mod auth;
pub mod briefing;
pub mod config;
pub mod db;          // Keep for now — removed in Task 8
pub mod models;
pub mod openapi;
pub mod routes;
pub mod state;
```

- [ ] **Step 4: Verify plnd_api still compiles (no changes to route handlers yet)**

```bash
just verify-build 2>&1 | grep "error\[" | head -20
```

Expected: clean compile. We added new modules without removing anything.

---

## Task 7: Update plnd_api route handlers and openapi.rs

**Files:**
- Modify: `plnd_api/src/openapi.rs`
- Modify: `plnd_api/src/state.rs`
- Modify: `plnd_api/src/routes/users.rs`
- Modify: `plnd_api/src/routes/dietary_restrictions.rs`
- Modify: `plnd_api/src/routes/preferences.rs`
- Modify: `plnd_api/src/routes/system.rs`
- Modify: `plnd_api/src/routes/schedule.rs`
- Modify: `plnd_api/src/routes/tasks.rs`
- Modify: `plnd_api/src/routes/search.rs`
- Modify: `plnd_api/src/routes/catalog_details.rs`
- Modify: `plnd_api/src/routes/catalog_ingest.rs`
- Modify: `plnd_api/src/routes/user_dish_prefs.rs`
- Modify: `plnd_api/src/routes/user_ingredient_prefs.rs`
- Modify: `plnd_api/src/routes/user_meal_prefs.rs`
- Modify: `plnd_api/src/routes/auth.rs`

### openapi.rs

- [ ] **Step 1: Update plnd_api/src/openapi.rs**

Replace the existing imports and schema registrations:

```rust
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::api_response::{DietaryRestrictionResponse, UserPreferencesResponse, UserResponse};
use crate::models::ReadyStatus;
use crate::routes::{
    briefing::{NewsHeadlineResponse, NewsResponse, WeatherResponse, YesterdayResponse},
    dietary_restrictions::{CreateRestrictionRequest, UpdateRestrictionRequest},
    users::UpdateProfileRequest,
};

struct BearerSecurityAddon;

impl Modify for BearerSecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_auth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .build(),
            ),
        );
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "PLND API",
        version = "0.1.0",
        description = "Neurodivergent-focused planner API for nutrition, exercise, and daily planning"
    ),
    paths(
        crate::routes::system::health_check,
        crate::routes::system::readiness_check,
        crate::routes::auth::token_exchange,
        crate::routes::auth::logout,
        crate::routes::users::get_me,
        crate::routes::users::patch_me,
        crate::routes::users::delete_me,
        crate::routes::users::post_complete_onboarding,
        crate::routes::preferences::get_preferences,
        crate::routes::briefing::get_weather,
        crate::routes::briefing::get_news,
        crate::routes::briefing::get_yesterday,
        crate::routes::dietary_restrictions::list_restrictions,
        crate::routes::dietary_restrictions::create_restriction,
        crate::routes::dietary_restrictions::update_restriction,
        crate::routes::dietary_restrictions::delete_restriction,
    ),
    components(schemas(
        UserResponse,
        UserPreferencesResponse,
        DietaryRestrictionResponse,
        ReadyStatus,
        UpdateProfileRequest,
        CreateRestrictionRequest,
        UpdateRestrictionRequest,
        WeatherResponse,
        NewsHeadlineResponse,
        NewsResponse,
        YesterdayResponse,
    )),
    modifiers(&BearerSecurityAddon),
    tags(
        (name = "System", description = "Health and readiness endpoints"),
        (name = "Auth", description = "Token exchange and session management"),
        (name = "Users", description = "User profile management"),
        (name = "Preferences", description = "User preference settings"),
        (name = "Dietary Restrictions", description = "Dietary restriction management"),
        (name = "Briefing", description = "Morning briefing — weather, news, and yesterday recap"),
    )
)]
pub struct ApiDoc;
```

### state.rs

- [ ] **Step 2: Update plnd_api/src/state.rs**

```rust
use crate::auth::{JwksCache, JwtService, SessionService};
use crate::briefing::BriefingState;
use plnd_data::db::Database;
use plnd_data::search::ProviderSearchService;
use std::sync::Arc;

/// Shared application state available to all route handlers
#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub jwt: JwtService,
    pub session: SessionService,
    pub jwks: Arc<JwksCache>,
    pub oidc_client_id: String,
    pub provider_search: ProviderSearchService,
    pub briefing: BriefingState,
}
```

### routes/users.rs

- [ ] **Step 3: Update plnd_api/src/routes/users.rs**

Change the imports and return types. The function logic is unchanged — only the return type and `utoipa::path` body references change:

```rust
use crate::api_response::UserResponse;
use crate::auth::jwt::Claims;
use plnd_data::db;
use crate::state::AppState;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[utoipa::path(
    get,
    path = "/users/me",
    tag = "Users",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Current user profile", body = UserResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "User not found"),
    )
)]
pub async fn get_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    match db::users::find_by_id(pool, user_id).await.map_err(|e| {
        eprintln!("get_me DB error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })? {
        Some(user) => Ok(Json(UserResponse::from(user))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[utoipa::path(
    patch,
    path = "/users/me",
    tag = "Users",
    security(("bearer_auth" = [])),
    request_body = UpdateProfileRequest,
    responses(
        (status = 200, description = "Updated user profile", body = UserResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "User not found"),
        (status = 422, description = "Validation error"),
    )
)]
pub async fn patch_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<Json<UserResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if let Some(ref name) = body.display_name {
        if name.len() > 100 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    if let Some(ref url) = body.avatar_url {
        if url.len() > 500 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }

    let pool = state.db.get_pool();

    match db::users::update_profile(
        pool,
        user_id,
        body.display_name.as_deref(),
        body.avatar_url.as_deref(),
    )
    .await
    .map_err(|e| {
        eprintln!("patch_me DB error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })? {
        Some(user) => Ok(Json(UserResponse::from(user))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[utoipa::path(
    post,
    path = "/users/me/complete-onboarding",
    tag = "Users",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Onboarding marked complete"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
pub async fn post_complete_onboarding(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();
    db::users::complete_onboarding(pool, user_id)
        .await
        .map_err(|e| {
            eprintln!("complete_onboarding error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(StatusCode::OK)
}

#[utoipa::path(
    delete,
    path = "/users/me",
    tag = "Users",
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Account deactivated"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "User not found"),
    )
)]
pub async fn delete_me(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    let found = db::users::deactivate_user(pool, user_id)
        .await
        .map_err(|e| {
            eprintln!("delete_me DB error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if found {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}
```

### routes/dietary_restrictions.rs

- [ ] **Step 4: Update plnd_api/src/routes/dietary_restrictions.rs**

Change imports and return types to use `DietaryRestrictionResponse`:

```rust
use crate::api_response::DietaryRestrictionResponse;
use crate::auth::jwt::Claims;
use plnd_data::db;
use crate::state::AppState;
// ... (axum imports unchanged)
```

Update each handler return type and map the DB result:
- `list_restrictions` returns `Json<Vec<DietaryRestrictionResponse>>`
  - Change: `.map(Json)` → `.map(|v| Json(v.into_iter().map(DietaryRestrictionResponse::from).collect()))`
- `create_restriction` returns `(StatusCode, Json<DietaryRestrictionResponse>)`
  - Change: `.map(|r| (StatusCode::CREATED, Json(r)))` → `.map(|r| (StatusCode::CREATED, Json(DietaryRestrictionResponse::from(r))))`
- `update_restriction` returns `Json<DietaryRestrictionResponse>`
  - Change: `.map(Json)` → `.map(|r| Json(DietaryRestrictionResponse::from(r)))`
- `delete_restriction` — no model in return type, unchanged except import

Update all `#[utoipa::path]` body references:
- `body = Vec<DietaryRestriction>` → `body = Vec<DietaryRestrictionResponse>`
- `body = DietaryRestriction` → `body = DietaryRestrictionResponse`

### routes/preferences.rs

- [ ] **Step 5: Update plnd_api/src/routes/preferences.rs**

```rust
use crate::api_response::UserPreferencesResponse;
use crate::auth::jwt::Claims;
use crate::models::PatchPreferencesRequest;
use plnd_data::db;
use crate::state::AppState;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

#[utoipa::path(
    patch,
    path = "/preferences/me",
    tag = "Preferences",
    request_body = PatchPreferencesRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Updated preferences", body = UserPreferencesResponse),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Validation error"),
        (status = 500, description = "Internal server error"),
    )
)]
pub async fn patch_preferences(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PatchPreferencesRequest>,
) -> Result<Json<UserPreferencesResponse>, StatusCode> {
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

    db::preferences::patch_preferences(
        pool,
        user_id,
        body.week_start_day,
        body.planning_trigger_offset,
        body.default_plan_length_days,
        body.wake_time,
    )
    .await
    .map(|p| Json(UserPreferencesResponse::from(p)))
    .map_err(|e| {
        eprintln!("patch_preferences error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

#[utoipa::path(
    get,
    path = "/preferences/me",
    tag = "Preferences",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "User preferences", body = UserPreferencesResponse),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
pub async fn get_preferences(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserPreferencesResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::preferences::get_or_create(pool, user_id)
        .await
        .map(|p| Json(UserPreferencesResponse::from(p)))
        .map_err(|e| {
            eprintln!("get_preferences DB error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
```

### routes/system.rs

- [ ] **Step 6: Update plnd_api/src/routes/system.rs**

```rust
use crate::models::ReadyStatus;
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use chrono::Utc;
use std::sync::Arc;

// utoipa::path annotations and function bodies unchanged
// Only the import changes: was `crate::db::models::ReadyStatus`, now `crate::models::ReadyStatus`
```

### routes/schedule.rs

- [ ] **Step 7: Update plnd_api/src/routes/schedule.rs**

Map from `PostSchedulePlanRequest` → `CommitPlanInput` at the route boundary. Remove `#[utoipa::path]` annotations (schedule routes are not registered in `openapi.rs`):

```rust
use crate::auth::jwt::Claims;
use crate::models::{CarryoverDecision as HttpCarryoverDecision, PostSchedulePlanRequest};
use crate::state::AppState;
use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use plnd_data::db;
use plnd_data::db::models::{
    CarryoverDecision, CommitPlanInput, PlanEntryInput, PlanStatusResponse, PostSchedulePlanResponse,
    SchedulePeriodResponse,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct PeriodQuery {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

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

    // Map from HTTP request type to DB-layer input type
    let entries = body.entries.into_iter().map(|e| PlanEntryInput {
        date: e.date,
        task_type: e.task_type,
        task_ref_id: e.task_ref_id,
        task_ref_type: e.task_ref_type,
        title: e.title,
        scheduled_start: e.scheduled_start,
        after_milepost: e.after_milepost,
    }).collect();

    let carryover_decisions: HashMap<Uuid, CarryoverDecision> = body
        .carryover_decisions
        .into_iter()
        .map(|(id, d)| {
            let db_decision = match d {
                HttpCarryoverDecision::Accept => CarryoverDecision::Accept,
                HttpCarryoverDecision::Defer => CarryoverDecision::Defer,
                HttpCarryoverDecision::Dismiss => CarryoverDecision::Dismiss,
            };
            (id, db_decision)
        })
        .collect();

    let input = CommitPlanInput {
        plan_start: body.plan_start,
        plan_end: body.plan_end,
        planning_task_id: body.planning_task_id,
        entries,
        replace: body.replace.unwrap_or(false),
        carryover_decisions,
    };

    db::schedule::commit_plan(pool, user_id, &input)
        .await
        .map(Json)
        .map_err(|e| match e {
            plnd_data::db::error::DatabaseError::ValidationError(_) => StatusCode::BAD_REQUEST,
            _ => {
                eprintln!("post_plan error: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}
```

### Remaining route files

- [ ] **Step 8: Update remaining route files**

For each of these files, make the same two mechanical changes:
1. Replace `use crate::db` / `use crate::db::models::X` with `use plnd_data::db` / `use plnd_data::db::models::X`
2. Remove all `#[utoipa::path(...)]` attribute blocks (these routes are not in `openapi.rs`)

Files to update: `auth.rs`, `tasks.rs`, `search.rs`, `catalog_details.rs`, `catalog_ingest.rs`, `user_dish_prefs.rs`, `user_ingredient_prefs.rs`, `user_meal_prefs.rs`

For `auth.rs` specifically — it likely calls `db::users::find_by_email` and `db::users::create`. Check the file and apply the `crate::db` → `plnd_data::db` import change. Keep its `#[utoipa::path]` annotations intact since `auth::token_exchange` and `auth::logout` ARE registered in `openapi.rs`.

- [ ] **Step 9: Verify plnd_api compiles**

```bash
just verify-build 2>&1 | grep "error\[" | head -30
```

Expected: clean compile.

---

## Task 8: Remove plnd_api/src/db/ and clean up Cargo.toml

**Files:**
- Delete: `plnd_api/src/db/` (all 16 files)
- Modify: `plnd_api/src/lib.rs`
- Modify: `plnd_api/Cargo.toml`

- [ ] **Step 1: Remove pub mod db from plnd_api/src/lib.rs**

```rust
pub mod api_response;
pub mod auth;
pub mod briefing;
pub mod config;
pub mod models;
pub mod openapi;
pub mod routes;
pub mod state;
```

- [ ] **Step 2: Delete the old plnd_api/src/db/ directory**

```bash
rm -rf plnd_api/src/db/
```

- [ ] **Step 3: Remove sqlx from plnd_api/Cargo.toml**

Remove this line:
```toml
sqlx = { version = "0.8", features = ["postgres", "uuid", "chrono", "runtime-tokio", "migrate", "json", "rust_decimal"] }
```

Leave `uuid`, `chrono`, `rust_decimal` as direct deps (still used in `models.rs`, `api_response.rs`, auth, config).

- [ ] **Step 4: Verify plnd_api compiles cleanly**

```bash
just verify-build
```

Expected: clean build for both `plnd_data` and `plnd_api`.

---

## Task 9: Full quality check and commit

- [ ] **Step 1: Run just verify**

```bash
just verify
```

Expected: all checks pass — fmt, clippy, deny, machete, ts-lint, ts-deps, verify-build.

If `machete` flags dependencies in `plnd_api` that were previously only used by sqlx (like `rust_decimal` feature `db-postgres`), remove the `db-postgres` feature flag from that dep.

- [ ] **Step 2: Run just test-ci**

```bash
just test-ci
```

Expected: all tests pass.

- [ ] **Step 3: Commit and push**

```bash
git add -p  # stage changes selectively, exclude any accidental files
git commit -m "$(cat <<'EOF'
refactor: migrate DB layer from plnd_api to plnd_data (#158)

Moves all 15 DB modules to plnd_data/src/db/, establishing plnd_data as
the single owner of all data-at-rest concerns. Strips utoipa::ToSchema from
moved types; adds three API response wrapper types in plnd_api. Decouples
db::preferences and db::schedule from HTTP request types.

Closes #158

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Open PR**

```bash
gh pr create \
  --title "refactor: migrate DB layer from plnd_api to plnd_data (#158)" \
  --body "$(cat <<'EOF'
## Summary

- Moves all 15 DB modules from `plnd_api/src/db/` → `plnd_data/src/db/`
- Strips `utoipa::ToSchema` from all moved types
- Creates `plnd_api/src/api_response.rs` with `UserResponse`, `UserPreferencesResponse`, `DietaryRestrictionResponse` wrappers
- Decouples `preferences::patch_preferences` and `schedule::commit_plan` from HTTP request types by introducing `CommitPlanInput`/`PlanEntryInput`/`CarryoverDecision` in `plnd_data`
- HTTP-only types (`PatchPreferencesRequest`, `PostSchedulePlanRequest`, `ReadyStatus`) move to `plnd_api/src/models.rs`
- Removes `sqlx` as a direct `plnd_api` dependency
- Removes dead `#[utoipa::path]` annotations from routes not registered in `openapi.rs`

## Test plan
- [ ] `just verify` passes cleanly
- [ ] `just test-ci` passes
- [ ] Server starts (`just test-run-server`)
- [ ] OpenAPI spec still renders at `/scalar` or `/swagger-ui`

Closes #158

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
