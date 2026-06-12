# Task `one_shot` User Override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user override the agent-inferred `one_shot` flag on a task — durably from the day view, and (only when the agent is genuinely uncertain) via a pre-creation clarification checkbox.

**Architecture:** Reuse the existing `one_shot` column (issue #81's `time_sensitive` is functionally `one_shot`; see the design doc). No new DB field or migration. Backend gains a field on the entry response plus a `PATCH …/one-shot` endpoint cloned from the existing status-patch path. The day view gets a toggle on each task row. The agent prompt gains `one_shot` as a rare, uncertainty-gated `request_clarification` trigger.

**Tech Stack:** Rust/Axum (`plnd_api`), `plnd_data` (sqlx, repository traits), `plnd_agent` (prompt markdown), Angular (`plnd_client`, signals, Karma specs), Playwright e2e.

**Design doc:** `docs/superpowers/specs/2026-06-12-task-one-shot-override-design.md`

---

## Conventions for every task

- **Work in the worktree:** `/Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag`. Use `git -C <worktree> …` for git.
- **Rust tests run inside `just verify`** — the project forbids `just test`/`just test-ci` and raw `cargo nextest`. Use `just verify-build` for fast compile feedback during red/green; run `just verify` at each task's verification checkpoint (it is the sanctioned omnibus and self-manages containers via a flock semaphore — do not kill port 3000).
- **Angular unit tests in a worktree:** run from `<worktree>/plnd_client` with `npx ng test --watch=false --browsers=ChromeHeadless` (NOT `just test-ng-headless`, which runs the main checkout).
- **Commit after each task.** Branch is `feat/task-time-sensitive-flag`; never commit to `main`. End commit messages with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- Run the full `just verify` once before the final push (not necessarily after every task).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `plnd_api/src/api_response.rs` | HTTP DTO for schedule entries | Add `one_shot` field + map it |
| `plnd_data/src/db/schedule.rs` | SQL for schedule entries | Add `update_entry_one_shot` fn |
| `plnd_data/src/repository/schedule.rs` | Repository trait | Add `update_entry_one_shot` method |
| `plnd_data/src/repository/pg/schedule.rs` | Postgres impl | Delegate to the db fn |
| `plnd_api/src/models.rs` | HTTP request bodies | Add `PatchEntryOneShotRequest` |
| `plnd_api/src/routes/schedule.rs` | Schedule route handlers | Add `patch_entry_one_shot` |
| `plnd_api/src/main.rs` | Route registration | Register `…/one-shot` route |
| `plnd_agent/src/prompts/task_entry.md` | Task-entry agent prompt | Add `one_shot` uncertainty guidance |
| `plnd_agent/src/context/mod.rs` | Prompt tests | Assert prompt mentions one-shot |
| `plnd_client/src/app/core/models/schedule.ts` | Day-view task model | Add `oneShot` |
| `plnd_client/src/app/core/services/schedule.service.ts` | Schedule state + API | Map `one_shot`; add `setEntryOneShot` |
| `plnd_client/src/app/features/schedule/components/task-row/task-row.ts` | Task row UI | Add one-time toggle + output |
| `plnd_client/src/app/features/day-view/day-view.ts` | Day-view page | Wire toggle output to service |
| `plnd_client/e2e/tests/day-view.e2e.ts` | E2E | Toggle → absent from carryover |

---

## Task 1: Expose `one_shot` in the schedule entry HTTP response

Without this, the client always receives `one_shot = undefined`, so the day-view toggle cannot reflect real state.

**Files:**
- Modify: `plnd_api/src/api_response.rs:440-459` (struct), `:461-480` (From impl)
- Test: same file, `#[cfg(test)]` module

- [ ] **Step 1: Write the failing test**

Add to the tests module in `plnd_api/src/api_response.rs` (mirror the existing `From<ScheduleEntry>` shape; build a `ScheduleEntry` with `one_shot: true`). If a helper constructor for `ScheduleEntry` is not already in scope, construct it with all fields explicitly.

```rust
#[test]
fn schedule_entry_response_includes_one_shot() {
    use plnd_data::models::ScheduleEntry;
    use chrono::{NaiveDate, Utc};
    use uuid::Uuid;

    let entry = ScheduleEntry {
        entry_id: Uuid::nil(),
        user_id: Uuid::nil(),
        routine_id: None,
        task_type: "general".into(),
        title: Some("take evening meds".into()),
        date: NaiveDate::from_ymd_opt(2026, 6, 12).unwrap(),
        scheduled_start: None,
        scheduled_end: None,
        status: "planned".into(),
        actual_start: None,
        actual_end: None,
        after_anchor: None,
        slot_meal_anchor_id: None,
        deviation_note: None,
        duration_minutes: None,
        energy_required: None,
        one_shot: true,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    let resp = ScheduleEntryResponse::from(entry);
    assert!(resp.one_shot);
}
```

- [ ] **Step 2: Verify it fails to compile**

Run: `just verify-build`
Expected: FAIL — `ScheduleEntryResponse` has no field `one_shot`.

- [ ] **Step 3: Add the field and map it**

In the struct (after `energy_required`, before `created_at`):

```rust
    pub energy_required: Option<String>,
    pub one_shot: bool,
    pub created_at: DateTime<Utc>,
```

In the `From<ScheduleEntry>` impl (after `energy_required: e.energy_required,`):

```rust
            energy_required: e.energy_required,
            one_shot: e.one_shot,
```

- [ ] **Step 4: Verify the test passes**

Run: `just verify-build` then `just verify`
Expected: build OK; `schedule_entry_response_includes_one_shot` passes.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag add plnd_api/src/api_response.rs
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag commit -m "feat(schedule): expose one_shot in schedule entry response (#81)"
```

---

## Task 2: `update_entry_one_shot` repository method

Clone of the existing `update_entry_status` path.

**Files:**
- Modify: `plnd_data/src/db/schedule.rs:96-117` (add fn after `update_entry_status`)
- Modify: `plnd_data/src/repository/schedule.rs:36-41` (trait)
- Modify: `plnd_data/src/repository/pg/schedule.rs:64-73` (impl)
- Test: `plnd_data/src/db/schedule.rs` `#[cfg(test)]` module (DB-backed `#[sqlx::test]`)

- [ ] **Step 1: Write the failing test**

Add to the tests module in `plnd_data/src/db/schedule.rs` (mirror existing `#[sqlx::test]` tests there — they raw-insert entries and assert). Insert one entry, flip its `one_shot`, read it back.

```rust
#[sqlx::test]
async fn update_entry_one_shot_flips_the_flag(pool: PgPool) {
    let uid = Uuid::new_v4();
    let entry_id = Uuid::new_v4();
    let date = NaiveDate::from_ymd_opt(2026, 6, 10).unwrap();

    sqlx::query(
        "INSERT INTO schedule_entries (entry_id, user_id, task_type, title, date, status, one_shot)
         VALUES ($1, $2, 'general', 'evening meds', $3, 'planned', FALSE)",
    )
    .bind(entry_id)
    .bind(uid)
    .bind(date)
    .execute(&pool)
    .await
    .unwrap();

    update_entry_one_shot(&pool, uid, entry_id, true).await.unwrap();

    let row: (bool,) = sqlx::query_as("SELECT one_shot FROM schedule_entries WHERE entry_id = $1")
        .bind(entry_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(row.0, "one_shot must be updated to true");

    // Unknown id → NotFound
    let err = update_entry_one_shot(&pool, uid, Uuid::new_v4(), true).await;
    assert!(matches!(err, Err(DatabaseError::NotFound)));
}
```

- [ ] **Step 2: Verify it fails**

Run: `just verify-build`
Expected: FAIL — `update_entry_one_shot` not found.

- [ ] **Step 3: Implement the db function**

In `plnd_data/src/db/schedule.rs`, after `update_entry_status` (ends line ~117):

```rust
#[tracing::instrument(skip(pool), fields(table = "schedule_entries", op = "update_entry_one_shot"))]
pub async fn update_entry_one_shot(
    pool: &PgPool,
    user_id: Uuid,
    entry_id: Uuid,
    one_shot: bool,
) -> Result<(), DatabaseError> {
    let result = sqlx::query(
        "UPDATE schedule_entries SET one_shot = $1, updated_at = NOW()
         WHERE entry_id = $2 AND user_id = $3",
    )
    .bind(one_shot)
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

- [ ] **Step 4: Add the trait method**

In `plnd_data/src/repository/schedule.rs`, after the `update_entry_status` method (line ~41):

```rust
    async fn update_entry_one_shot(
        &self,
        user_id: Uuid,
        entry_id: Uuid,
        one_shot: bool,
    ) -> Result<(), crate::Error>;
```

- [ ] **Step 5: Implement the trait method (pg)**

In `plnd_data/src/repository/pg/schedule.rs`, after the `update_entry_status` impl (line ~73):

```rust
    async fn update_entry_one_shot(
        &self,
        user_id: Uuid,
        entry_id: Uuid,
        one_shot: bool,
    ) -> Result<(), crate::Error> {
        schedule::update_entry_one_shot(&self.pool, user_id, entry_id, one_shot)
            .await
            .map_err(Into::into)
    }
```

- [ ] **Step 6: Verify the test passes**

Run: `just verify`
Expected: `update_entry_one_shot_flips_the_flag` passes; full suite green.

- [ ] **Step 7: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag add plnd_data/src/db/schedule.rs plnd_data/src/repository/schedule.rs plnd_data/src/repository/pg/schedule.rs
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag commit -m "feat(data): add update_entry_one_shot repository method (#81)"
```

---

## Task 3: `PATCH /schedule/entries/{id}/one-shot` endpoint

Clone of `patch_entry_status` (`plnd_api/src/routes/schedule.rs:319-359`).

**Files:**
- Modify: `plnd_api/src/models.rs:138-141` (add request struct after `PatchEntryStatusRequest`)
- Modify: `plnd_api/src/routes/schedule.rs` (import + handler after `patch_entry_status`)
- Modify: `plnd_api/src/main.rs:375-378` (register route)
- Test: `plnd_api/tests/schedule_test.rs` (DB-backed integration test — mirror existing patch-status coverage there)

- [ ] **Step 1: Add the request struct**

In `plnd_api/src/models.rs`, after `PatchEntryStatusRequest` (line ~141):

```rust
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PatchEntryOneShotRequest {
    pub one_shot: bool,
}
```

- [ ] **Step 2: Write the failing integration test**

In `plnd_api/tests/schedule_test.rs`, mirror an existing test that authenticates, seeds an entry, and PATCHes it. Use the existing helpers in that file (seed a user/token, insert a schedule entry, then call the endpoint). Assert `204` and that the persisted `one_shot` flipped, plus `404` for an unknown id.

```rust
#[sqlx::test]
async fn patch_entry_one_shot_updates_and_404s(pool: PgPool) {
    // Arrange: stand up the app + an authenticated user with one planned entry.
    // (Use the same harness helpers the other tests in this file use.)
    let ctx = TestApp::seeded(pool).await;
    let entry_id = ctx.insert_planned_entry("evening meds", false).await;

    // Act + Assert: flip one_shot → 204, persisted true.
    let res = ctx
        .patch_json(&format!("/schedule/entries/{entry_id}/one-shot"), serde_json::json!({ "one_shot": true }))
        .await;
    assert_eq!(res.status(), 204);
    assert!(ctx.entry_one_shot(entry_id).await);

    // Unknown id → 404.
    let res = ctx
        .patch_json(&format!("/schedule/entries/{}/one-shot", Uuid::new_v4()), serde_json::json!({ "one_shot": true }))
        .await;
    assert_eq!(res.status(), 404);
}
```

> Note: match the actual harness API in `schedule_test.rs`. If no `TestApp` helper exists, replicate the setup pattern used by the nearest existing PATCH/POST test in that file (the names above are illustrative — use the file's real helpers).

- [ ] **Step 3: Verify it fails**

Run: `just verify-build`
Expected: FAIL — route/handler not defined.

- [ ] **Step 4: Add the import**

In `plnd_api/src/routes/schedule.rs`, add `PatchEntryOneShotRequest` to the `crate::models` import group (alongside `PatchEntryStatusRequest`).

- [ ] **Step 5: Add the handler**

In `plnd_api/src/routes/schedule.rs`, after `patch_entry_status` (ends line ~359):

```rust
#[utoipa::path(
    patch,
    path = "/schedule/entries/{id}/one-shot",
    tag = "Schedule",
    params(("id" = Uuid, Path, description = "Schedule entry ID")),
    request_body = PatchEntryOneShotRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "one_shot updated"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Entry not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn patch_entry_one_shot(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(entry_id): Path<Uuid>,
    Json(body): Json<PatchEntryOneShotRequest>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .schedule
        .update_entry_one_shot(user_id, entry_id, body.one_shot)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| match e {
            Error::NotFound => StatusCode::NOT_FOUND,
            _ => {
                tracing::error!(error = %e, "patch_entry_one_shot error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}
```

- [ ] **Step 6: Register the route**

In `plnd_api/src/main.rs`, after the `…/status` route block (line ~378):

```rust
        .route(
            "/schedule/entries/{id}/one-shot",
            patch(schedule::patch_entry_one_shot),
        )
```

- [ ] **Step 7: Register the OpenAPI path + schema**

In `plnd_api/src/openapi.rs`, add `schedule::patch_entry_one_shot` to the `paths(...)` list and `PatchEntryOneShotRequest` to the `components(schemas(...))` list, next to the existing `patch_entry_status` / `PatchEntryStatusRequest` entries. (Grep `patch_entry_status` in that file to find both locations.)

- [ ] **Step 8: Verify the test passes**

Run: `just verify`
Expected: `patch_entry_one_shot_updates_and_404s` passes; full suite green.

- [ ] **Step 9: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag add plnd_api/src/models.rs plnd_api/src/routes/schedule.rs plnd_api/src/main.rs plnd_api/src/openapi.rs plnd_api/tests/schedule_test.rs
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag commit -m "feat(api): add PATCH /schedule/entries/{id}/one-shot (#81)"
```

---

## Task 4: Agent prompt — `one_shot` uncertainty-gated clarification

Make the agent ask about one-shot **only** when it genuinely cannot infer it; otherwise set it silently on `create_task`. Mirrors the existing `duration_minutes` clarification carve-out.

**Files:**
- Modify: `plnd_agent/src/prompts/task_entry.md` (clarification section ~line 38-40, and ui_signals section ~line 115-128)
- Test: `plnd_agent/src/context/mod.rs` `#[cfg(test)]` module (prompt-content assertion, mirror `system_prompts_contain_security_guard` at line ~537)

- [ ] **Step 1: Write the failing test**

Add to the tests module in `plnd_agent/src/context/mod.rs`:

```rust
#[test]
fn task_entry_prompt_covers_one_shot_uncertainty() {
    let p = UseCase::TaskEntry.system_prompt();
    assert!(
        p.contains("one_shot"),
        "task_entry prompt must guide the one_shot decision"
    );
    assert!(
        p.contains("carryover") || p.contains("carry over"),
        "task_entry prompt must tie one_shot to carryover"
    );
}
```

- [ ] **Step 2: Verify it fails**

Run: `just verify-build`
Expected: FAIL — assertion fails (prompt does not yet mention `one_shot`).

- [ ] **Step 3: Edit the clarification carve-out**

In `plnd_agent/src/prompts/task_entry.md`, find the line (~40):

```
The only field that genuinely warrants `request_clarification` is `duration_minutes` when it is completely absent and cannot be reasonably inferred. Energy level, date, and placement can almost always be inferred.
```

Replace with:

```
Two fields can warrant `request_clarification`: (1) `duration_minutes` when it is completely absent and cannot be reasonably inferred, and (2) `one_shot` when you genuinely cannot tell whether the task is meaningful only within its window. Energy level, date, and placement can almost always be inferred.
```

- [ ] **Step 4: Add the one_shot decision guidance**

In `task_entry.md`, add a numbered consideration in the inference list (after the "Recurring?" item, ~line 24):

```
4. **One-time only?** — Decide `one_shot`: is the task meaningful only within its scheduled window (e.g. "take evening meds", "morning workout" — missed yesterday cannot be done today) versus still relevant if missed (e.g. "call the dentist")? One-shot tasks are silently dropped at window close and never surface in carryover review. **When you are confident, set `one_shot` directly on `create_task` and do not ask.** Only when the one-shot nature is genuinely ambiguous, call `request_clarification` with a `show_checkbox` for `one_shot` so the user decides — phrased in plain language, e.g. label "One-time only — won't carry over if missed".
```

- [ ] **Step 5: Add a one_shot ui_signal example**

In the `## ui_signals` section of `task_entry.md` (near the `recurring` example, ~line 128), add:

```
  { "type": "show_checkbox", "field": "one_shot", "label": "One-time only — won't carry over if missed", "default": false },
```

- [ ] **Step 6: Verify the test passes**

Run: `just verify-build` then `just verify`
Expected: `task_entry_prompt_covers_one_shot_uncertainty` passes; full suite green.

- [ ] **Step 7: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag add plnd_agent/src/prompts/task_entry.md plnd_agent/src/context/mod.rs
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag commit -m "feat(agent): ask about one_shot only when uncertain (#81)"
```

---

## Task 5: Client model + mapping — surface `oneShot` in the day view

**Files:**
- Modify: `plnd_client/src/app/core/models/schedule.ts:6-12` (`ScheduleTask`)
- Modify: `plnd_client/src/app/core/services/schedule.service.ts:199-206` (`mapEntry`)
- Test: `plnd_client/src/app/core/services/schedule.service.spec.ts`

- [ ] **Step 1: Write the failing test**

In `schedule.service.spec.ts`, add a test that `mapEntry` (or the loaded `scheduleItems`) reflects `one_shot`. If `mapEntry` is not exported, assert via a loaded schedule. Simplest: export `mapEntry` is not needed — test through the public load path with an HTTP mock returning an entry with `one_shot: true`, then read `scheduleItems()`. Mirror the existing spec's HTTP-mock setup.

```ts
it('maps one_shot from the DTO onto the task', () => {
  // Drive a load whose /schedule/period response contains an entry with one_shot: true,
  // using the same HttpTestingController setup the other tests in this file use.
  const task = loadSingleEntry({ entry_id: 'e1', task_type: 'general', title: 'meds',
    date: '2026-06-12', scheduled_start: '', status: 'planned', one_shot: true });
  expect(task.oneShot).toBe(true);
});
```

> Use the spec file's existing helpers/providers (`provideHttpClient`, `provideHttpClientTesting`, `HttpTestingController`). Do not use the deprecated `HttpClientTestingModule`.

- [ ] **Step 2: Verify it fails**

Run (from `<worktree>/plnd_client`): `npx ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `oneShot` does not exist on `ScheduleTask`.

- [ ] **Step 3: Add `oneShot` to the model**

In `plnd_client/src/app/core/models/schedule.ts`:

```ts
export interface ScheduleTask {
  id: string;
  type: ItemType;
  label: string;
  status: ItemStatus;
  scheduledTime?: string; // e.g. '11 AM'
  oneShot: boolean;
}
```

- [ ] **Step 4: Map it**

In `schedule.service.ts` `mapEntry`:

```ts
function mapEntry(e: ScheduleEntryDto): ScheduleTask {
  return {
    id:      e.entry_id,
    type:    parseItemType(e.task_type),
    label:   e.title ?? e.task_type,
    status:  e.status === 'completed' ? 'done' : 'pending',
    oneShot: e.one_shot ?? false,
  };
}
```

> Note: any other place that constructs a `ScheduleTask` literal (e.g. the agent `addItem` path or `plan-tasks-step`) will now need `oneShot`. The compiler will flag them — set `oneShot: false` at those construction sites.

- [ ] **Step 5: Verify the test passes**

Run (from `<worktree>/plnd_client`): `npx ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS; no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag add plnd_client/src/app/core/models/schedule.ts plnd_client/src/app/core/services/schedule.service.ts
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag commit -m "feat(client): surface oneShot on day-view tasks (#81)"
```

---

## Task 6: `ScheduleService.setEntryOneShot`

Optimistic update + PATCH, mirroring `toggleItem` (`schedule.service.ts:70-93`).

**Files:**
- Modify: `plnd_client/src/app/core/services/schedule.service.ts` (new method after `toggleItem`)
- Test: `plnd_client/src/app/core/services/schedule.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('setEntryOneShot PATCHes the one-shot endpoint and updates state', () => {
  // load a single entry with one_shot:false (reuse the helper from Task 5)
  service.setEntryOneShot('e1', true);
  const req = httpMock.expectOne(`${BASE}/schedule/entries/e1/one-shot`);
  expect(req.request.method).toBe('PATCH');
  expect(req.request.body).toEqual({ one_shot: true });
  req.flush(null, { status: 204, statusText: 'No Content' });
  const task = service.scheduleItems().find(i => i.id === 'e1') as ScheduleTask;
  expect(task.oneShot).toBe(true);
});
```

- [ ] **Step 2: Verify it fails**

Run (from `<worktree>/plnd_client`): `npx ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `setEntryOneShot` is not a function.

- [ ] **Step 3: Implement the method**

In `schedule.service.ts`, after `toggleItem` (line ~93):

```ts
  /** Set a task's one-shot flag (carry-over vs one-time). Optimistic; reloads on error. */
  setEntryOneShot(id: string, oneShot: boolean): void {
    this._items.update(items =>
      items.map(item =>
        !isMealAnchor(item) && item.id === id ? { ...item, oneShot } : item,
      ),
    );
    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}/one-shot`, { one_shot: oneShot })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
  }
```

- [ ] **Step 4: Verify the test passes**

Run (from `<worktree>/plnd_client`): `npx ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag add plnd_client/src/app/core/services/schedule.service.ts plnd_client/src/app/core/services/schedule.service.spec.ts
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag commit -m "feat(client): add setEntryOneShot service method (#81)"
```

---

## Task 7: `task-row` one-time toggle + day-view wiring

A subtle, keyboard-accessible control. Quiet by default; emphasized only when the task IS one-time (sensory-friendly).

**Files:**
- Modify: `plnd_client/src/app/features/schedule/components/task-row/task-row.ts`
- Modify: `plnd_client/src/app/features/day-view/day-view.ts:66-68`
- Test: `plnd_client/src/app/features/schedule/components/task-row/task-row.spec.ts`

- [ ] **Step 1: Write the failing test**

In `task-row.spec.ts` (create if absent; mirror sibling component specs — standalone component, `ComponentFixture`):

```ts
it('emits oneShotToggled with the inverted value when the toggle is clicked', () => {
  fixture.componentRef.setInput('item', {
    id: 't1', type: 'general', label: 'meds', status: 'pending', oneShot: false,
  });
  fixture.detectChanges();
  let emitted: { id: string; oneShot: boolean } | undefined;
  component.oneShotToggled.subscribe(e => (emitted = e));
  const btn = fixture.nativeElement.querySelector('.one-shot-toggle') as HTMLButtonElement;
  btn.click();
  expect(emitted).toEqual({ id: 't1', oneShot: true });
});
```

- [ ] **Step 2: Verify it fails**

Run (from `<worktree>/plnd_client`): `npx ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL — no `.one-shot-toggle` element / no `oneShotToggled` output.

- [ ] **Step 3: Add the output + handler**

In `task-row.ts`, add to the class:

```ts
  readonly oneShotToggled = output<{ id: string; oneShot: boolean }>();

  protected toggleOneShot(): void {
    this.oneShotToggled.emit({ id: this.item().id, oneShot: !this.item().oneShot });
  }
```

- [ ] **Step 4: Add the control to the template**

In `task-row.ts`, add after the type-badge block (inside `.task-row`, after line ~41):

```html
      <button
        type="button"
        class="one-shot-toggle"
        [class.active]="item().oneShot"
        [attr.aria-pressed]="item().oneShot"
        [attr.aria-label]="item().oneShot
          ? item().label + ' is one-time only; tap to let it carry over'
          : 'Mark ' + item().label + ' one-time only (won\'t carry over if missed)'"
        (click)="toggleOneShot()"
      >⤓</button>
```

Add to `task-row.scss` a quiet default / emphasized-when-active style:

```scss
.one-shot-toggle {
  border: none; background: none; cursor: pointer;
  font-size: 12px; line-height: 1; padding: 2px 4px;
  color: var(--color-text-muted); opacity: 0.45;
}
.one-shot-toggle.active {
  opacity: 1; color: var(--color-accent-dark);
}
.one-shot-toggle:focus-visible { outline: 2px solid var(--color-accent-border); border-radius: 4px; }
```

> Pick the glyph to match the codebase's icon convention if one exists; `⤓` ("one-time / drops away") is a placeholder that is visually distinct from the done checkmark. Confirm against existing badges in `task-row` before finalizing.

- [ ] **Step 5: Wire the day view**

In `day-view.ts`, update the `app-task-row` usage (line ~66):

```html
                <app-task-row
                  [item]="item"
                  (toggled)="scheduleService.toggleItem($event)"
                  (oneShotToggled)="scheduleService.setEntryOneShot($event.id, $event.oneShot)"
                />
```

- [ ] **Step 6: Verify the test passes**

Run (from `<worktree>/plnd_client`): `npx ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag add plnd_client/src/app/features/schedule/components/task-row/ plnd_client/src/app/features/day-view/day-view.ts
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag commit -m "feat(client): add one-time toggle to day-view task rows (#81)"
```

---

## Task 8: E2E — toggle one-time, confirm it leaves carryover

**Files:**
- Modify: `plnd_client/e2e/tests/day-view.e2e.ts` (add a test; reuse `seedAuth`/`seedOnboarding`/`seedScheduleEntries` helpers)

Per the e2e mock policy: schedule + carryover flow through the real backend; only agent endpoints are mocked. The toggle endpoint and the carryover query are real, so this exercises the full path.

- [ ] **Step 1: Write the test**

In `day-view.e2e.ts`, add (adapt selectors/helpers to the file's existing conventions):

```ts
test('one-time toggle removes a stale task from the next carryover review', async ({ page }) => {
  await seedAuth(page);
  await seedOnboarding(page);
  // Seed a non-one-shot, incomplete entry dated before the next plan window.
  await seedScheduleEntries(page, [
    { title: 'evening meds', task_type: 'general', date: yesterdayIso(), status: 'planned', one_shot: false },
  ]);

  await page.goto('/day');
  const row = page.getByText('evening meds');
  await expect(row).toBeVisible();

  // Flip it to one-time via the row toggle.
  await page.getByRole('button', { name: /one-time only/i }).first().click();

  // Start planning → the carryover review must NOT list it.
  await page.goto('/plan');
  await expect(page.getByText('evening meds')).toHaveCount(0);
});
```

> If `seedScheduleEntries` does not accept `one_shot`, seed it `false` and rely solely on the UI toggle to set it (the point of the test). Add a `yesterdayIso()` local helper if the file lacks one. Confirm the planning entry point route (`/plan`) and the carryover step's DOM against the current app.

- [ ] **Step 2: Run the full verification (includes e2e)**

Run: `just verify`
Expected: all gates green, including the new e2e test.

- [ ] **Step 3: Commit**

```bash
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag add plnd_client/e2e/tests/day-view.e2e.ts
git -C /Users/robert/Development/plnd/.worktrees/feat-task-time-sensitive-flag commit -m "test(e2e): one-time toggle excludes task from carryover (#81)"
```

---

## Final verification & PR

- [ ] `git -C <worktree> fetch origin && git -C <worktree> rebase origin/main`
- [ ] `just verify` (full suite green from the worktree)
- [ ] Run the code-review subagent before pushing (per project convention: review before PR, not after).
- [ ] `git -C <worktree> push --force-with-lease -u origin feat/task-time-sensitive-flag`
- [ ] `gh pr create` — body explains the reframe (reuse `one_shot`; no new field) and `Closes #81`.
- [ ] Comment on issue #81 recording the reframe (per the design doc's §7 follow-up).
- [ ] Invoke `monitor-pr` to watch CI and address review comments.

---

## Self-review notes (coverage check)

- Spec §4.1 backend endpoint → Tasks 2 + 3. ✅
- Spec §4.2 uncertainty-gated `request_clarification` → Task 4. ✅
- Spec §4.3 day-view toggle (`ScheduleTask.oneShot`, mapping, control, wiring) → Tasks 5 + 6 + 7. ✅
- Spec §4.4 copy ("One-time only" / "Won't carry over…") → Tasks 4 (signal label) + 7 (aria labels). ✅
- Spec §6 testing (Rust repo + route, Angular mapping/service/row, e2e carryover) → Tasks 2, 3, 5, 6, 7, 8. ✅
- Implicit prerequisite (DTO did not expose `one_shot`) → Task 1. ✅
- Spec §7 follow-up (comment on #81) → Final section. ✅
