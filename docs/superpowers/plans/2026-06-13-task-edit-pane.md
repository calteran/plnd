# Task Edit Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline task-edit pane to the day view that edits six task fields (title, type, start time, duration, energy, skip-if-missed) through a single optimistic update path.

**Architecture:** A new `TaskEditFormComponent` (reactive form) is hosted inside `TaskRowComponent` when its row is in edit mode. `DayViewComponent` owns an `editingId` signal, applies a dim+inert "spotlight" to non-edited rows, and routes the form's `save` patch to `ScheduleService.updateEntry()`. Persistence consolidates all six fields (including `one_shot`) onto one new `PATCH /schedule/entries/{id}` endpoint backed by a new `ScheduleRepository::update_entry` method; the redundant dedicated one-shot route/method/client-method are removed.

**Tech Stack:** Rust/Axum (`plnd_api`), `plnd_data` repository layer (sqlx, Postgres), Angular (standalone components, signals, reactive forms), Playwright e2e.

**Reference spec:** `docs/superpowers/specs/2026-06-13-task-edit-pane-design.md`

**Conventions for every task:** run quality with `just verify` only at the integration checkpoints noted (not after every micro-step). For Angular unit runs during development use `npx ng test` from `<worktree>/plnd_client/`. Never run `cargo run`. Commit after each task.

---

## File Structure

**Backend (Rust):**
- Modify `plnd_data/src/db/schedule.rs` — add `update_entry` SQL fn; remove `update_entry_one_shot`; update test module.
- Modify `plnd_data/src/repository/schedule.rs` — add `EntryPatch` struct + `update_entry` trait method; remove `update_entry_one_shot`.
- Modify `plnd_data/src/repository/pg/schedule.rs` — implement `update_entry`; remove `update_entry_one_shot`.
- Modify `plnd_data/src/models/schedule.rs` — add `EntryPatch` (DB-layer input struct).
- Modify `plnd_api/src/models.rs` — add `PatchEntryRequest`; remove `PatchEntryOneShotRequest`.
- Modify `plnd_api/src/routes/schedule.rs` — add `patch_entry` handler + `validate_patch`; remove `patch_entry_one_shot`.
- Modify `plnd_api/src/main.rs` — register `PATCH /schedule/entries/{id}`; remove one-shot route.
- Modify `plnd_api/src/openapi.rs` — swap schema/path registration.

**Client (Angular):**
- Modify `plnd_client/src/app/core/models/week-plan.ts` — widen `ScheduleEntryDto`.
- Modify `plnd_client/src/app/core/models/schedule.ts` — add fields to `ScheduleTask`; add `TaskEditPatch`.
- Modify `plnd_client/src/app/core/services/schedule.service.ts` — `updateEntry`; map new fields; remove `setEntryOneShot`.
- Create `plnd_client/src/app/features/schedule/components/task-edit-form/task-edit-form.ts` (+ `.scss`, `.spec.ts`).
- Modify `plnd_client/src/app/features/schedule/components/task-row/task-row.ts` (+ `.scss`, `.spec.ts`).
- Modify `plnd_client/src/app/features/day-view/day-view.ts` (+ `.scss`, `.spec.ts`).
- Create `plnd_client/e2e/task-edit.spec.ts`.

---

## Task 1: DB layer — `update_entry` partial update

**Files:**
- Modify: `plnd_data/src/models/schedule.rs`
- Modify: `plnd_data/src/db/schedule.rs:119-144` (remove one-shot fn) and add new fn near it
- Test: `plnd_data/src/db/schedule.rs` test module (replace `update_entry_one_shot_flips_the_flag`)

- [ ] **Step 1: Add the DB-layer patch struct**

In `plnd_data/src/models/schedule.rs`, after `PlanEntryInput` (line ~101), add:

```rust
/// Partial update for a single schedule entry. `None` fields are left unchanged.
/// `scheduled_start` carries a UTC wall-clock time-of-day (combined with the entry's
/// existing date by the SQL layer).
#[derive(Debug, Clone, Default)]
pub struct EntryPatch {
    pub title: Option<String>,
    pub task_type: Option<String>,
    pub scheduled_start: Option<chrono::NaiveTime>,
    pub duration_minutes: Option<i32>,
    pub energy_required: Option<String>,
    pub one_shot: Option<bool>,
}
```

- [ ] **Step 2: Write the failing DB test**

In `plnd_data/src/db/schedule.rs`, replace the `update_entry_one_shot_flips_the_flag` test (lines ~1627-1660) with:

```rust
    // -----------------------------------------------------------------------
    // update_entry
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn update_entry_changes_only_provided_fields(pool: PgPool) {
        let uid = new_user(&pool).await;
        let entry_id = Uuid::new_v4();
        let date = NaiveDate::from_ymd_opt(2026, 6, 10).unwrap();

        sqlx::query(
            "INSERT INTO schedule_entries
               (entry_id, user_id, task_type, title, date, status, one_shot, duration_minutes, energy_required)
             VALUES ($1, $2, 'general', 'evening meds', $3, 'planned', FALSE, 15, 'low')",
        )
        .bind(entry_id).bind(uid).bind(date)
        .execute(&pool).await.unwrap();

        // Patch title + one_shot only; leave duration/energy/type untouched.
        let patch = crate::models::EntryPatch {
            title: Some("evening medication".to_string()),
            one_shot: Some(true),
            ..Default::default()
        };
        update_entry(&pool, uid, entry_id, &patch).await.unwrap();

        let row: (String, bool, Option<i32>, Option<String>) = sqlx::query_as(
            "SELECT title, one_shot, duration_minutes, energy_required
             FROM schedule_entries WHERE entry_id = $1",
        )
        .bind(entry_id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "evening medication");
        assert!(row.1);
        assert_eq!(row.2, Some(15), "duration must be unchanged");
        assert_eq!(row.3.as_deref(), Some("low"), "energy must be unchanged");

        // Unknown id → NotFound
        let err = update_entry(&pool, uid, Uuid::new_v4(), &patch).await;
        assert!(matches!(err, Err(DatabaseError::NotFound)));
    }
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test -p plnd_data --lib db::schedule::tests::update_entry_changes_only_provided_fields`
Expected: FAIL — `cannot find function update_entry`.

- [ ] **Step 4: Implement `update_entry`; remove `update_entry_one_shot`**

In `plnd_data/src/db/schedule.rs`, delete `update_entry_one_shot` (lines ~119-144) and add:

```rust
#[tracing::instrument(
    skip(pool, patch),
    fields(table = "schedule_entries", op = "update_entry")
)]
pub async fn update_entry(
    pool: &PgPool,
    user_id: Uuid,
    entry_id: Uuid,
    patch: &crate::models::EntryPatch,
) -> Result<(), DatabaseError> {
    // COALESCE keeps the existing value when a bind is NULL (field omitted).
    // scheduled_start is combined with the row's existing date in UTC.
    let result = sqlx::query(
        "UPDATE schedule_entries SET
             title            = COALESCE($1, title),
             task_type        = COALESCE($2, task_type),
             scheduled_start  = COALESCE(
                 CASE WHEN $3::time IS NULL THEN NULL
                      ELSE (date + $3::time) AT TIME ZONE 'UTC' END,
                 scheduled_start),
             duration_minutes = COALESCE($4, duration_minutes),
             energy_required  = COALESCE($5, energy_required),
             one_shot         = COALESCE($6, one_shot),
             updated_at       = NOW()
         WHERE entry_id = $7 AND user_id = $8",
    )
    .bind(patch.title.as_deref())
    .bind(patch.task_type.as_deref())
    .bind(patch.scheduled_start)
    .bind(patch.duration_minutes)
    .bind(patch.energy_required.as_deref())
    .bind(patch.one_shot)
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test -p plnd_data --lib db::schedule::tests::update_entry_changes_only_provided_fields`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plnd_data/src/models/schedule.rs plnd_data/src/db/schedule.rs
git commit -m "feat(data): update_entry partial update; drop update_entry_one_shot (db layer)"
```

---

## Task 2: Repository trait + pg impl — `update_entry`

**Files:**
- Modify: `plnd_data/src/repository/schedule.rs:43-48` (remove one-shot; add update_entry)
- Modify: `plnd_data/src/repository/pg/schedule.rs:75-84` (remove one-shot; add update_entry)

- [ ] **Step 1: Update the trait**

In `plnd_data/src/repository/schedule.rs`, change the import line 5 to include `EntryPatch`:

```rust
use crate::models::{CommitPlanInput, EntryPatch, OpenSlot, ScheduleEntry};
```

Replace the `update_entry_one_shot` trait method (lines ~43-48) with:

```rust
    async fn update_entry(
        &self,
        user_id: Uuid,
        entry_id: Uuid,
        patch: &EntryPatch,
    ) -> Result<(), crate::Error>;
```

- [ ] **Step 2: Update the pg impl**

In `plnd_data/src/repository/pg/schedule.rs`, change import line 7 to:

```rust
use crate::models::{CommitPlanInput, EntryPatch, OpenSlot, ScheduleEntry};
```

Replace the `update_entry_one_shot` impl (lines ~75-84) with:

```rust
    async fn update_entry(
        &self,
        user_id: Uuid,
        entry_id: Uuid,
        patch: &EntryPatch,
    ) -> Result<(), crate::Error> {
        schedule::update_entry(&self.pool, user_id, entry_id, patch)
            .await
            .map_err(Into::into)
    }
```

- [ ] **Step 3: Compile-check (the trait change must propagate)**

Run: `cargo build -p plnd_data`
Expected: builds. (If any mock repo in `plnd_data` implements the trait, update it the same way — search `impl ScheduleRepository`.)

- [ ] **Step 4: Commit**

```bash
git add plnd_data/src/repository/schedule.rs plnd_data/src/repository/pg/schedule.rs
git commit -m "feat(data): ScheduleRepository::update_entry; drop update_entry_one_shot"
```

---

## Task 3: HTTP request type + validation

**Files:**
- Modify: `plnd_api/src/models.rs:143-148` (remove `PatchEntryOneShotRequest`; add `PatchEntryRequest`)
- Test: `plnd_api/src/routes/schedule.rs` test module (add `validate_patch` tests)

- [ ] **Step 1: Add `PatchEntryRequest`; remove `PatchEntryOneShotRequest`**

In `plnd_api/src/models.rs`, delete `PatchEntryOneShotRequest` (lines ~143-148) and add:

```rust
/// Body for `PATCH /schedule/entries/{id}`. All fields optional; omitted fields are unchanged.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PatchEntryRequest {
    pub title: Option<String>,
    pub task_type: Option<String>,
    /// UTC wall-clock time as "HH:MM" or "HH:MM:SS".
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub scheduled_start: Option<NaiveTime>,
    pub duration_minutes: Option<i32>,
    pub energy_required: Option<String>,
    pub one_shot: Option<bool>,
}
```

- [ ] **Step 2: Write the failing validation test**

In `plnd_api/src/routes/schedule.rs`, inside the existing `mod tests`, add:

```rust
    #[test]
    fn validate_patch_accepts_valid_fields() {
        let req = PatchEntryRequest {
            title: Some("Call dentist".into()),
            task_type: Some("appointment".into()),
            scheduled_start: None,
            duration_minutes: Some(30),
            energy_required: Some("low".into()),
            one_shot: Some(true),
        };
        assert!(validate_patch(&req).is_ok());
    }

    #[test]
    fn validate_patch_rejects_bad_type_energy_duration_and_blank_title() {
        let bad_type = PatchEntryRequest { task_type: Some("nope".into()), ..empty_patch() };
        assert!(validate_patch(&bad_type).is_err());

        let bad_energy = PatchEntryRequest { energy_required: Some("ultra".into()), ..empty_patch() };
        assert!(validate_patch(&bad_energy).is_err());

        let bad_dur = PatchEntryRequest { duration_minutes: Some(0), ..empty_patch() };
        assert!(validate_patch(&bad_dur).is_err());

        let blank = PatchEntryRequest { title: Some("   ".into()), ..empty_patch() };
        assert!(validate_patch(&blank).is_err());
    }

    fn empty_patch() -> PatchEntryRequest {
        PatchEntryRequest {
            title: None, task_type: None, scheduled_start: None,
            duration_minutes: None, energy_required: None, one_shot: None,
        }
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p plnd_api --lib routes::schedule::tests::validate_patch`
Expected: FAIL — `cannot find function validate_patch` / `PatchEntryRequest` not imported in route module.

- [ ] **Step 4: Implement `validate_patch` and wire the import**

In `plnd_api/src/routes/schedule.rs`, change the `crate::models` import (lines ~6-9) to swap `PatchEntryOneShotRequest` for `PatchEntryRequest`:

```rust
use crate::models::{
    CarryoverDecision as HttpCarryoverDecision, MealEntryRequest, PatchEntryRequest,
    PatchEntryStatusRequest, PlanEntryRequest, PostSchedulePlanRequest,
};
```

Add the validation helper near `VALID_STATUSES` (line ~317):

```rust
/// Validate a partial entry update. Returns `Err` with a 400 for any provided-but-invalid field.
fn validate_patch(req: &PatchEntryRequest) -> Result<(), StatusCode> {
    if let Some(t) = &req.task_type {
        if !VALID_TASK_TYPES.contains(&t.as_str()) {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    if let Some(e) = &req.energy_required {
        if !VALID_ENERGY_LEVELS.contains(&e.as_str()) {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    if let Some(d) = req.duration_minutes {
        if d <= 0 {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    if let Some(t) = &req.title {
        if t.trim().is_empty() {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    Ok(())
}
```

(`VALID_TASK_TYPES` and `VALID_ENERGY_LEVELS` are already imported at the top of the file.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p plnd_api --lib routes::schedule::tests::validate_patch`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add plnd_api/src/models.rs plnd_api/src/routes/schedule.rs
git commit -m "feat(api): PatchEntryRequest + validate_patch; drop PatchEntryOneShotRequest"
```

---

## Task 4: HTTP handler + route registration

**Files:**
- Modify: `plnd_api/src/routes/schedule.rs:361-397` (remove `patch_entry_one_shot`; add `patch_entry`)
- Modify: `plnd_api/src/main.rs:383-386`
- Modify: `plnd_api/src/openapi.rs:10,189`

- [ ] **Step 1: Replace the handler**

In `plnd_api/src/routes/schedule.rs`, delete `patch_entry_one_shot` and its `#[utoipa::path]` (lines ~361-397) and add:

```rust
#[utoipa::path(
    patch,
    path = "/schedule/entries/{id}",
    tag = "Schedule",
    params(("id" = Uuid, Path, description = "Schedule entry ID")),
    request_body = PatchEntryRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Entry updated"),
        (status = 400, description = "Invalid field value"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Entry not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn patch_entry(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(entry_id): Path<Uuid>,
    Json(body): Json<PatchEntryRequest>,
) -> Result<StatusCode, StatusCode> {
    validate_patch(&body)?;
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let patch = plnd_data::models::EntryPatch {
        title: body.title.map(|t| t.trim().to_string()),
        task_type: body.task_type,
        scheduled_start: body.scheduled_start,
        duration_minutes: body.duration_minutes,
        energy_required: body.energy_required,
        one_shot: body.one_shot,
    };

    state
        .repos
        .schedule
        .update_entry(user_id, entry_id, &patch)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| match e {
            Error::NotFound => StatusCode::NOT_FOUND,
            _ => {
                tracing::error!(error = %e, "patch_entry error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}
```

Add `EntryPatch` to the `plnd_data::models` import block (lines ~20-22):

```rust
use plnd_data::models::{
    CarryoverDecision, CommitPlanInput, EntryPatch, PlanEntryInput, PlannedMealEntryStaging,
};
```
…and use `EntryPatch` directly (drop the fully-qualified path in the handler if you add the import).

- [ ] **Step 2: Register the route; remove the old one**

In `plnd_api/src/main.rs`, replace the one-shot route block (lines ~383-386) with:

```rust
        .route(
            "/schedule/entries/{id}",
            patch(schedule::patch_entry),
        )
```

- [ ] **Step 3: Fix OpenAPI registration**

In `plnd_api/src/openapi.rs`: in the `paths(...)` macro replace `schedule::patch_entry_one_shot` with `schedule::patch_entry`; in `components(schemas(...))` replace `PatchEntryOneShotRequest` with `PatchEntryRequest`.

- [ ] **Step 4: Build + server startup smoke test**

Run: `just verify-build`
Expected: workspace compiles (no references to removed symbols remain).
Run: `just test-run-server`
Expected: server boots and is killed after 15s with no panic.

- [ ] **Step 5: Commit**

```bash
git add plnd_api/src/routes/schedule.rs plnd_api/src/main.rs plnd_api/src/openapi.rs
git commit -m "feat(api): PATCH /schedule/entries/{id}; remove dedicated one-shot route"
```

---

## Task 5: Client models — widen DTO + `ScheduleTask` + `TaskEditPatch`

**Files:**
- Modify: `plnd_client/src/app/core/models/week-plan.ts:117-127`
- Modify: `plnd_client/src/app/core/models/schedule.ts:6-13`

- [ ] **Step 1: Widen `ScheduleEntryDto`**

In `week-plan.ts`, update the interface to consume fields the API already returns:

```ts
export interface ScheduleEntryDto {
  entry_id: string;
  task_type: string;
  title?: string;
  date: string;
  scheduled_start?: string | null;
  status: string;
  after_anchor?: string;
  slot_meal_anchor_id?: string;
  duration_minutes?: number | null;
  energy_required?: string | null;
  one_shot?: boolean;
}
```

- [ ] **Step 2: Extend `ScheduleTask` and add `TaskEditPatch`**

In `schedule.ts`, replace the `ScheduleTask` interface and add the patch type + import `EnergyLevel`:

```ts
import { MealNutrition, EnergyLevel } from './week-plan';

export interface ScheduleTask {
  id: string;
  type: ItemType;
  label: string;
  status: ItemStatus;
  scheduledTime?: string;     // gutter display (unchanged; still unpopulated for tasks)
  scheduledStart?: string;    // editable "HH:MM" (UTC wall-clock); undefined for floating tasks
  durationMinutes?: number;
  energy?: EnergyLevel;
  oneShot: boolean;
  floating: boolean;          // true when placed in a slot (after_anchor) with no fixed time
}

/** Partial edit emitted by the task-edit form; mirrors PatchEntryRequest. */
export interface TaskEditPatch {
  title?: string;
  type?: ItemType;
  scheduledStart?: string;    // "HH:MM"
  durationMinutes?: number;
  energy?: EnergyLevel;
  oneShot?: boolean;
}
```

- [ ] **Step 3: Type-check**

Run: from `plnd_client/`, `npx tsc -p tsconfig.app.json --noEmit`
Expected: errors only in `schedule.service.ts` (mapEntry doesn't yet set the new fields) — fixed in Task 6.

- [ ] **Step 4: Commit**

```bash
git add plnd_client/src/app/core/models/week-plan.ts plnd_client/src/app/core/models/schedule.ts
git commit -m "feat(client): widen ScheduleEntryDto/ScheduleTask; add TaskEditPatch"
```

---

## Task 6: Service — `updateEntry`, map new fields, remove `setEntryOneShot`

**Files:**
- Modify: `plnd_client/src/app/core/services/schedule.service.ts`
- Test: `plnd_client/src/app/core/services/schedule.service.spec.ts`

- [ ] **Step 1: Write the failing service test**

In `schedule.service.spec.ts`, add (adapt the existing `HttpTestingController` setup used by other specs in the file):

```ts
it('updateEntry optimistically patches and PATCHes the entry', () => {
  service.loadDay('2026-06-13');
  // flush the load (period + anchors) exactly as the existing load tests do, then:
  service.updateEntry('entry-1', { title: 'New title', oneShot: true });

  const item = service.scheduleItems().find(i => i.id === 'entry-1');
  expect((item as ScheduleTask).label).toBe('New title');
  expect((item as ScheduleTask).oneShot).toBeTrue();

  const req = httpMock.expectOne(r =>
    r.method === 'PATCH' && r.url.endsWith('/schedule/entries/entry-1'));
  expect(req.request.body).toEqual({ title: 'New title', one_shot: true });
  req.flush(null, { status: 204, statusText: 'No Content' });
});
```

(Use the file's existing seeding helper to make `entry-1` present after `loadDay`. If none exists, flush the `GET /schedule/period` with one entry whose `entry_id` is `entry-1` and the `GET /schedule/anchors` with `[]`.)

- [ ] **Step 2: Run to verify it fails**

Run: from `plnd_client/`, `npx ng test --include='**/schedule.service.spec.ts' --watch=false`
Expected: FAIL — `updateEntry` is not a function.

- [ ] **Step 3: Implement mapping + `updateEntry`; remove `setEntryOneShot`**

In `schedule.service.ts`, update `mapEntry` (lines ~231-239):

```ts
function mapEntry(e: ScheduleEntryDto): ScheduleTask {
  const floating = !e.scheduled_start;
  return {
    id:      e.entry_id,
    type:    parseItemType(e.task_type),
    label:   e.title ?? e.task_type,
    status:  e.status === 'completed' ? 'done' : 'pending',
    scheduledStart: e.scheduled_start ? hhmmUtc(e.scheduled_start) : undefined,
    durationMinutes: e.duration_minutes ?? undefined,
    energy:  (e.energy_required as ScheduleTask['energy']) ?? undefined,
    oneShot: e.one_shot ?? false,
    floating,
  };
}

/** Extract a UTC "HH:MM" from an ISO timestamp (matches the API's wall-clock convention). */
function hhmmUtc(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
```

Remove `setEntryOneShot` (lines ~95-125) and add, next to `toggleItem`:

```ts
/**
 * Apply a partial edit to a task entry (title/type/time/duration/energy/one_shot).
 * Optimistic: updates the in-memory item, PATCHes, and reloads the day on error.
 */
updateEntry(id: string, patch: TaskEditPatch): void {
  if (findItemStatus(this._items(), id) === null) return;

  this._items.update(items =>
    items.map(item => {
      const apply = (t: ScheduleTask): ScheduleTask => ({
        ...t,
        label:           patch.title ?? t.label,
        type:            patch.type ?? t.type,
        scheduledStart:  patch.scheduledStart ?? t.scheduledStart,
        durationMinutes: patch.durationMinutes ?? t.durationMinutes,
        energy:          patch.energy ?? t.energy,
        oneShot:         patch.oneShot ?? t.oneShot,
      });
      if (isMealAnchor(item)) {
        if (!item.duringMealTasks.some(t => t.id === id)) return item;
        return { ...item, duringMealTasks: item.duringMealTasks.map(t => t.id === id ? apply(t) : t) };
      }
      return item.id === id ? apply(item) : item;
    }),
  );

  this.http
    .patch(`${this.apiBase}/schedule/entries/${id}`, toPatchBody(patch))
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe({ error: () => this.loadDay(this._date()) });
}
```

Add the body mapper in the utilities section:

```ts
function toPatchBody(p: TaskEditPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (p.title !== undefined)           body['title'] = p.title;
  if (p.type !== undefined)            body['task_type'] = p.type;
  if (p.scheduledStart !== undefined)  body['scheduled_start'] = p.scheduledStart;
  if (p.durationMinutes !== undefined) body['duration_minutes'] = p.durationMinutes;
  if (p.energy !== undefined)          body['energy_required'] = p.energy;
  if (p.oneShot !== undefined)         body['one_shot'] = p.oneShot;
  return body;
}
```

Update imports at the top of the file: add `TaskEditPatch` to the `models/schedule` import.

- [ ] **Step 4: Run to verify it passes**

Run: from `plnd_client/`, `npx ng test --include='**/schedule.service.spec.ts' --watch=false`
Expected: PASS. (If a removed-`setEntryOneShot` test exists, delete it — its persistence assertion is covered by the new test.)

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/core/services/schedule.service.ts plnd_client/src/app/core/services/schedule.service.spec.ts
git commit -m "feat(client): ScheduleService.updateEntry; map duration/energy/time; remove setEntryOneShot"
```

---

## Task 7: `TaskEditFormComponent`

**Files:**
- Create: `plnd_client/src/app/features/schedule/components/task-edit-form/task-edit-form.ts`
- Create: `plnd_client/src/app/features/schedule/components/task-edit-form/task-edit-form.scss`
- Test: `plnd_client/src/app/features/schedule/components/task-edit-form/task-edit-form.spec.ts`

- [ ] **Step 1: Write the failing component test**

`task-edit-form.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskEditFormComponent } from './task-edit-form';
import { ScheduleTask } from '../../../../core/models/schedule';

function task(overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id: 't1', type: 'general', label: 'Call dentist', status: 'pending',
           oneShot: false, floating: false, scheduledStart: '11:00',
           durationMinutes: 30, energy: 'low', ...overrides };
}

describe('TaskEditFormComponent', () => {
  let fixture: ComponentFixture<TaskEditFormComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TaskEditFormComponent] }).compileComponents();
    fixture = TestBed.createComponent(TaskEditFormComponent);
  });

  it('emits a save patch with only the changed field on title blur', () => {
    fixture.componentRef.setInput('task', task());
    fixture.detectChanges();
    const saves: unknown[] = [];
    fixture.componentInstance.save.subscribe(p => saves.push(p));

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[name="title"]');
    input.value = 'Call orthodontist';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));

    expect(saves).toEqual([{ title: 'Call orthodontist' }]);
  });

  it('blocks a blank title (no save emitted)', () => {
    fixture.componentRef.setInput('task', task());
    fixture.detectChanges();
    const saves: unknown[] = [];
    fixture.componentInstance.save.subscribe(p => saves.push(p));

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[name="title"]');
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));

    expect(saves).toEqual([]);
  });

  it('disables the time field for a floating task', () => {
    fixture.componentRef.setInput('task', task({ floating: true, scheduledStart: undefined }));
    fixture.detectChanges();
    const time: HTMLInputElement = fixture.nativeElement.querySelector('input[name="time"]');
    expect(time.disabled).toBeTrue();
  });

  it('one-shot toggle has switch semantics and a state-dependent label', () => {
    fixture.componentRef.setInput('task', task());
    fixture.detectChanges();
    const toggle: HTMLElement = fixture.nativeElement.querySelector('[role="switch"]');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-label')?.toLowerCase()).toContain('skip if missed');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: from `plnd_client/`, `npx ng test --include='**/task-edit-form.spec.ts' --watch=false`
Expected: FAIL — cannot find module `./task-edit-form`.

- [ ] **Step 3: Implement the component**

`task-edit-form.ts`:

```ts
import { Component, computed, effect, input, output, signal } from '@angular/core';
import { ItemType, ScheduleTask, TaskEditPatch } from '../../../../core/models/schedule';
import { EnergyLevel } from '../../../../core/models/week-plan';

const TYPES: { value: ItemType; label: string }[] = [
  { value: 'work', label: 'Work' }, { value: 'exercise', label: 'Exercise' },
  { value: 'leisure', label: 'Leisure' }, { value: 'medication', label: 'Medication' },
  { value: 'appointment', label: 'Appointment' }, { value: 'general', label: 'General' },
];
const ENERGIES: EnergyLevel[] = ['low', 'medium', 'high'];

@Component({
  selector: 'app-task-edit-form',
  standalone: true,
  template: `
    <div class="task-edit-form" role="group" [attr.aria-label]="'Edit task: ' + task().label">
      <label class="field">
        <span class="field-label">Title</span>
        <input name="title" type="text" [value]="task().label"
               (input)="title.set($any($event.target).value)"
               (blur)="commitTitle()" (keydown.escape)="close.emit()" />
      </label>

      <label class="field">
        <span class="field-label">Type</span>
        <select name="type" [value]="task().type"
                (change)="save.emit({ type: $any($event.target).value })">
          @for (t of types; track t.value) { <option [value]="t.value">{{ t.label }}</option> }
        </select>
      </label>

      <label class="field">
        <span class="field-label">Time</span>
        <input name="time" type="time" [value]="task().scheduledStart ?? ''"
               [disabled]="task().floating"
               [attr.aria-describedby]="task().floating ? 'time-hint' : null"
               (change)="save.emit({ scheduledStart: $any($event.target).value })" />
        @if (task().floating) { <span id="time-hint" class="hint">set by its meal slot</span> }
      </label>

      <label class="field">
        <span class="field-label">Duration (min)</span>
        <input name="duration" type="number" min="1" [value]="task().durationMinutes ?? ''"
               (change)="commitDuration($any($event.target).value)" />
      </label>

      <label class="field">
        <span class="field-label">Energy</span>
        <select name="energy" [value]="task().energy ?? ''"
                (change)="save.emit({ energy: $any($event.target).value })">
          @for (e of energies; track e) { <option [value]="e">{{ e | titlecase }}</option> }
        </select>
      </label>

      <button type="button" class="one-shot-toggle" role="switch"
              [attr.aria-checked]="task().oneShot"
              [attr.aria-label]="oneShotLabel()"
              (click)="save.emit({ oneShot: !task().oneShot })">
        <span class="one-shot-text" aria-hidden="true">skip if missed</span>
      </button>

      <button type="button" class="done-edit" (click)="close.emit()">Done</button>
    </div>
  `,
  styleUrl: './task-edit-form.scss',
})
export class TaskEditFormComponent {
  readonly task = input.required<ScheduleTask>();
  readonly save = output<TaskEditPatch>();
  readonly close = output<void>();

  protected readonly types = TYPES;
  protected readonly energies = ENERGIES;
  protected readonly title = signal('');

  protected readonly oneShotLabel = computed(() =>
    this.task().oneShot
      ? `${this.task().label} will skip if missed — won't carry over if not done. Turn off to carry over.`
      : `${this.task().label} will carry over if not done. Turn on to skip if missed.`,
  );

  constructor() {
    effect(() => this.title.set(this.task().label));
  }

  protected commitTitle(): void {
    const next = this.title().trim();
    if (next && next !== this.task().label) this.save.emit({ title: next });
  }

  protected commitDuration(raw: string): void {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) this.save.emit({ durationMinutes: n });
  }
}
```

`task-edit-form.scss` (minimal, follows surrounding row padding):

```scss
.task-edit-form {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px 24px 16px 76px;       // align body with task-row text column
  background: var(--color-surface-white);
  border-bottom: 1px solid var(--color-border-row);
}
.field { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.field input, .field select {
  font: inherit; padding: 6px 8px;
  border: 1px solid var(--color-border-row); border-radius: 6px;
}
.field input:disabled { opacity: 0.6; }
.hint { font-size: 11px; color: var(--color-text-secondary); }
.one-shot-toggle {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border: 1px solid var(--color-border-row); border-radius: 6px;
  background: var(--color-surface-white); cursor: pointer;
}
.one-shot-toggle[aria-checked='true'] { border-color: var(--color-accent); color: var(--color-accent); }
.done-edit { align-self: flex-end; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
```

- [ ] **Step 4: Run to verify it passes**

Run: from `plnd_client/`, `npx ng test --include='**/task-edit-form.spec.ts' --watch=false`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/features/schedule/components/task-edit-form/
git commit -m "feat(client): TaskEditFormComponent (six-field inline editor)"
```

---

## Task 8: `TaskRowComponent` — editing/dimmed inputs, edit trigger, host the form

**Files:**
- Modify: `plnd_client/src/app/features/schedule/components/task-row/task-row.ts`
- Modify: `plnd_client/src/app/features/schedule/components/task-row/task-row.scss`
- Test: `plnd_client/src/app/features/schedule/components/task-row/task-row.spec.ts`

- [ ] **Step 1: Write failing tests (append to existing spec)**

```ts
it('emits editRequested when the label is tapped', () => {
  fixture.componentRef.setInput('item', baseTask());   // reuse the spec's existing task factory
  fixture.detectChanges();
  let requested: string | undefined;
  fixture.componentInstance.editRequested.subscribe(id => (requested = id));
  fixture.nativeElement.querySelector('.label').dispatchEvent(new Event('click'));
  expect(requested).toBe(baseTask().id);
});

it('renders the edit form when editing is true', () => {
  fixture.componentRef.setInput('item', baseTask());
  fixture.componentRef.setInput('editing', true);
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('app-task-edit-form')).toBeTruthy();
});

it('applies the dimmed class and inert when dimmed', () => {
  fixture.componentRef.setInput('item', baseTask());
  fixture.componentRef.setInput('dimmed', true);
  fixture.detectChanges();
  const row = fixture.nativeElement.querySelector('.task-row');
  expect(row.classList.contains('dimmed')).toBeTrue();
  expect(row.hasAttribute('inert')).toBeTrue();
});
```

If the spec lacks a `baseTask()` factory, add one returning a valid `ScheduleTask` (with `floating: false`).

- [ ] **Step 2: Run to verify it fails**

Run: from `plnd_client/`, `npx ng test --include='**/task-row.spec.ts' --watch=false`
Expected: FAIL — unknown inputs `editing`/`dimmed`, no `app-task-edit-form`.

- [ ] **Step 3: Implement the changes**

In `task-row.ts`: import `TaskEditFormComponent` and `TaskEditPatch`, add to `imports`, add inputs/outputs, make the label a button-like clickable, host the form, and wrap the row element:

- Add to component decorator: `imports: [TaskEditFormComponent]`.
- Add members:

```ts
readonly editing = input(false);
readonly dimmed  = input(false);
readonly editRequested = output<string>();
readonly save  = output<TaskEditPatch>();
readonly close = output<void>();
```

- Wrap the existing `.task-row` div, binding state, and add the form below it:

```html
<div class="task-row" [class.done]="item().status === 'done'"
     [class.dimmed]="dimmed()" [attr.inert]="dimmed() ? '' : null">
  ... existing gutter + checkbox ...
  <span class="label" role="button" tabindex="0"
        [class.struck]="item().status === 'done'"
        (click)="editRequested.emit(item().id)"
        (keydown.enter)="editRequested.emit(item().id)"
        (keydown.space)="editRequested.emit(item().id)">{{ item().label }}</span>
  ... existing type-badge + one-shot indicator ...
</div>
@if (editing()) {
  <app-task-edit-form [task]="item()" (save)="save.emit($event)" (close)="close.emit()" />
}
```

In `task-row.scss` add:

```scss
.task-row.dimmed { opacity: 0.4; transition: opacity 150ms ease; }
.label[role='button'] { cursor: pointer; }
@media (prefers-reduced-motion: reduce) {
  .task-row.dimmed { transition: none; }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: from `plnd_client/`, `npx ng test --include='**/task-row.spec.ts' --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/features/schedule/components/task-row/
git commit -m "feat(client): task-row edit trigger, dimmed/inert state, hosts edit form"
```

---

## Task 9: `DayViewComponent` — editingId, spotlight, scroll-anchor, wiring

**Files:**
- Modify: `plnd_client/src/app/features/day-view/day-view.ts`
- Modify: `plnd_client/src/app/features/day-view/day-view.scss`
- Test: `plnd_client/src/app/features/day-view/day-view.spec.ts`

- [ ] **Step 1: Write the failing test**

In `day-view.spec.ts` (reuse the existing `ScheduleService` mock/provider setup), add:

```ts
it('opens one editor at a time and dims the others', () => {
  // arrange: two task items in the service mock, render, then:
  component.openEditor('entry-1');
  fixture.detectChanges();
  expect(component.editingId()).toBe('entry-1');

  component.openEditor('entry-2');
  expect(component.editingId()).toBe('entry-2');   // switches, not stacks

  component.closeEditor();
  expect(component.editingId()).toBeNull();
});

it('routes a save patch to ScheduleService.updateEntry', () => {
  const spy = spyOn(component['scheduleService'], 'updateEntry');
  component.openEditor('entry-1');
  component.onEditSave('entry-1', { title: 'X' });
  expect(spy).toHaveBeenCalledWith('entry-1', { title: 'X' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: from `plnd_client/`, `npx ng test --include='**/day-view.spec.ts' --watch=false`
Expected: FAIL — `openEditor`/`editingId`/`onEditSave` not defined.

- [ ] **Step 3: Implement state + wiring**

In `day-view.ts`, add the signal and methods, and update the `app-task-row` usage:

```ts
protected readonly editingId = signal<string | null>(null);

openEditor(id: string): void { this.editingId.set(id); }
closeEditor(): void { this.editingId.set(null); }
onEditSave(id: string, patch: TaskEditPatch): void { this.scheduleService.updateEntry(id, patch); }
```

Update the template's task branch:

```html
<app-task-row
  [item]="item"
  [editing]="editingId() === item.id"
  [dimmed]="editingId() !== null && editingId() !== item.id"
  (toggled)="scheduleService.toggleItem($event)"
  (editRequested)="openEditor($event)"
  (save)="onEditSave(item.id, $event)"
  (close)="closeEditor()"
/>
```

Add the `TaskEditPatch` import. (Meal rows are dimmed too: wrap or add `[class.dimmed]` on `app-meal-row` via a host binding — for this PR, set `[attr.inert]` and a `dimmed` class on a wrapping element around each item in the `@for`, applying `editingId() !== null && editingId() !== item.id`.)

Concretely, wrap each item:

```html
@for (item of scheduleService.scheduleItems(); track item.id) {
  <div class="row-wrap" [class.dimmed]="editingId() !== null && editingId() !== item.id"
       [attr.inert]="editingId() !== null && editingId() !== item.id ? '' : null">
    @if (isMealAnchor(item)) { <app-meal-row ... /> }
    @else { <app-task-row [item]="item" [editing]="editingId() === item.id"
                          (editRequested)="openEditor($event)"
                          (save)="onEditSave(item.id, $event)"
                          (close)="closeEditor()"
                          (toggled)="scheduleService.toggleItem($event)" /> }
  </div>
}
```

(With the wrapper owning dim/inert, remove the `dimmed`/`inert` handling from `task-row` added in Task 8 to avoid double-dimming — keep `task-row`'s `editing` input and `editRequested`/`save`/`close` outputs. Adjust the Task 8 `dimmed` test to target `.row-wrap` instead, or drop it.)

In `day-view.scss`:

```scss
.row-wrap.dimmed { opacity: 0.4; transition: opacity 150ms ease; }
@media (prefers-reduced-motion: reduce) { .row-wrap.dimmed { transition: none; } }
```

- [ ] **Step 4: Scroll-anchor on open**

Add to `openEditor` (after setting the signal), scrolling the opened row into view on the next frame:

```ts
openEditor(id: string): void {
  this.editingId.set(id);
  queueMicrotask(() => {
    document.getElementById(`task-row-${id}`)
      ?.scrollIntoView({ block: 'nearest', behavior: this.prefersReducedMotion() ? 'auto' : 'smooth' });
  });
}
```

Add `id="task-row-{{item.id}}"` to the `.row-wrap`, and a `prefersReducedMotion()` helper:

```ts
private prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: from `plnd_client/`, `npx ng test --include='**/day-view.spec.ts' --watch=false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plnd_client/src/app/features/day-view/
git commit -m "feat(client): day-view inline editor — editingId, spotlight, scroll-anchor, wiring"
```

---

## Task 10: E2E — edit a task end-to-end against the real backend

**Files:**
- Create: `plnd_client/e2e/task-edit.spec.ts`

- [ ] **Step 1: Write the e2e test**

```ts
import { test, expect } from '@playwright/test';
import { seedAuth, seedOnboarding } from './helpers/auth';
import { seedScheduleEntries } from './helpers/seed-data';

test('edit a task title and skip-if-missed persists across reload', async ({ page }) => {
  await seedAuth(page);
  await seedOnboarding(page);
  const date = '2026-06-13';
  await seedScheduleEntries(page, date, [
    { title: 'Call dentist', task_type: 'appointment', scheduled_start: '11:00', duration_minutes: 30, energy_required: 'low' },
  ]);

  await page.goto(`/day/${date}`);
  await page.getByText('Call dentist').click();                       // open inline editor

  const title = page.locator('input[name="title"]');
  await title.fill('Call orthodontist');
  await title.blur();
  await page.getByRole('switch', { name: /skip if missed/i }).click(); // turn one_shot on

  await page.reload();
  await expect(page.getByText('Call orthodontist')).toBeVisible();
  await expect(page.locator('.one-shot-indicator')).toBeVisible();     // #911 read-only indicator now shows
});
```

(Verify the exact signature of `seedScheduleEntries` in `plnd_client/e2e/helpers/seed-data.ts` and adapt the entry shape if needed. Per the e2e mock policy, schedule endpoints hit the real backend — do not `page.route()` them.)

- [ ] **Step 2: Run the e2e test (requires the stack up)**

Run: `just verify` (brings up the API + runs the full pipeline incl. e2e). Confirm the new spec passes within the run.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/task-edit.spec.ts
git commit -m "test(e2e): inline task edit persists title + skip-if-missed"
```

---

## Task 11: Deferred-scope tracking issues + final verification

- [ ] **Step 1: Open tracking issues for the two deferred fields**

```bash
gh issue create --repo calteran/plnd \
  --title "Day-view task edit: move a task to another date" \
  --body "Follow-up to the inline task-edit pane (#914). Adds date editing to the day-view editor. Heavier than the core six: changing date moves the entry between days and can trigger lazy meal-anchor materialization (architecture §4.6). Deferred from the initial pane per docs/superpowers/specs/2026-06-13-task-edit-pane-design.md §2."

gh issue create --repo calteran/plnd \
  --title "Day-view task edit: reassign meal pairing / slot placement" \
  --body "Follow-up to the inline task-edit pane (#914). Adds meal-pairing (slot_meal_anchor_id / after_anchor) editing, incl. floating↔fixed conversion and an anchor-instance picker (architecture §4.8). The time field is currently disabled for floating tasks pending this work. Deferred per docs/superpowers/specs/2026-06-13-task-edit-pane-design.md §2/§6."
```

- [ ] **Step 2: Full verification**

Run: `just verify`
Expected: all gates green (quality + build + unit + e2e). Fix anything red before proceeding — no failure is acceptable.

- [ ] **Step 3: Final review + PR**

Use the `superpowers:requesting-code-review` skill, then rebase onto `origin/main` and open the PR (Closes #914), then invoke `monitor-pr`.

---

## Self-Review notes

- **Spec coverage:** §2 core-six → Tasks 5–9; deferred two + tracking issues → Task 11. §4 components → Tasks 7–9. §5 single optimistic path + removals → Tasks 1–4, 6. §6 backend (no read change; new write; validation; repo; floating-disabled) → Tasks 1–4, 7. §7 a11y (switch semantics, aria-label, inert, Escape, region label) → Tasks 7–9. §8 client models → Tasks 5–6. §9 testing → every task + Task 10. §10 architecture checklist → satisfied by the above.
- **Type consistency:** `EntryPatch` (Rust) ↔ `PatchEntryRequest` (HTTP) ↔ `TaskEditPatch` (client) ↔ `toPatchBody` JSON keys (`task_type`, `scheduled_start`, `duration_minutes`, `energy_required`, `one_shot`) all align field-for-field. `update_entry` name consistent across db/trait/pg. `editingId`/`openEditor`/`closeEditor`/`onEditSave` consistent across day-view tasks/tests.
- **Double-dim caveat** is called out in Task 9 Step 3 so the executor removes task-row's own dim handling in favor of the wrapper.
