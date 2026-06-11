# Log a Meal as Consumed/Skipped — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user mark a meal anchor instance consumed/skipped (or revert to planned) from the day view, wiring the existing (#829) `set_status` storage path through a new API endpoint and the existing—but currently misrouted—day-view controls, so `meals_logged` reflects real activity.

**Architecture:** Add `PATCH /schedule/anchors/{id}/status` calling `MealAnchorInstanceRepository::set_status`; expose `status`/`consumed_at` on the anchor read model so state round-trips. On the client, map the backend consumption status into `MealAnchor.status`, add a `setMealConsumption` service method that targets the new endpoint, and rewire the meal-row checkbox + Review-pane Skip/Done off the wrong `/schedule/entries/...` path. Skipped meals get a dimmed/struck-through treatment.

**Tech Stack:** Rust/Axum + utoipa (`plnd_api`), `plnd_data` repositories, Angular standalone components + signals (`plnd_client`), Playwright e2e.

**Reference spec:** `docs/superpowers/specs/2026-06-11-log-meal-consumed-design.md`

---

## File Structure

**Backend (`plnd_api`)**
- `src/api_response.rs` — add `status`/`consumed_at` to `MealAnchorInstanceResponse` + `From` impl.
- `src/models.rs` — new `SetAnchorStatusRequest` request model.
- `src/routes/schedule_anchors.rs` — new `set_status` handler (reuses existing `map_repo_error`).
- `src/main.rs` — register `PATCH /schedule/anchors/{id}/status`.
- `src/openapi.rs` — register path + schema.

**Frontend (`plnd_client`)**
- `src/app/core/models/week-plan.ts` — add `status`/`consumed_at` to `MealAnchorInstanceDto`.
- `src/app/core/services/schedule.service.ts` — consumption mapping helper, `setMealConsumption`, `toggleMealConsumed`; remove `skipMeal`.
- `src/app/features/day-view/day-view.ts` — rewire `(doneToggle)` / `(skipped)`.
- `src/app/features/schedule/components/meal-row/meal-row.ts` + `.scss` — skipped modifier class + styles.

**Tests**
- `plnd_client/e2e/tests/schedule-anchors-api.e2e.ts` — status-transition API coverage.
- `plnd_client/e2e/tests/log-meal-briefing.e2e.ts` — new: day-view log → briefing `meals_logged`.
- `plnd_client/src/app/core/services/schedule.service.spec.ts` — replace `skipMeal` block.
- `plnd_client/src/app/features/schedule/components/meal-row/meal-row.spec.ts` — skipped styling.
- `plnd_client/src/app/features/day-view/day-view.spec.ts` — add service spies.

---

## Task 1: Backend — round-trip `status`/`consumed_at` on the read model

**Files:**
- Modify: `plnd_api/src/api_response.rs:80-109`

- [ ] **Step 1: Add the two fields to the response struct**

In `plnd_api/src/api_response.rs`, inside `pub struct MealAnchorInstanceResponse`, add `status` and `consumed_at` immediately after `template_entry_id`:

```rust
pub struct MealAnchorInstanceResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub date: NaiveDate,
    pub name: String,
    pub preferred_time: NaiveTime,
    pub tolerance_minutes: i32,
    pub sort_order: i32,
    pub template_entry_id: Option<Uuid>,
    /// Consumption lifecycle: "planned" | "consumed" | "skipped".
    pub status: String,
    /// Set exactly when `status == "consumed"`.
    pub consumed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

- [ ] **Step 2: Map the fields in the `From` impl**

In the same file, inside `impl From<plnd_data::models::MealAnchorInstance> for MealAnchorInstanceResponse`, add the two assignments after `template_entry_id: i.template_entry_id,`:

```rust
            template_entry_id: i.template_entry_id,
            status: i.status,
            consumed_at: i.consumed_at,
            created_at: i.created_at,
```

(`DateTime`/`Utc` are already imported at the top of this file.)

- [ ] **Step 3: Verify it compiles**

Run: `just verify-build`
Expected: compiles (no server start).

- [ ] **Step 4: Commit**

```bash
git -C $(git rev-parse --show-toplevel) add plnd_api/src/api_response.rs
git -C $(git rev-parse --show-toplevel) commit -m "feat(api): expose consumption status on anchor instance response (#890)"
```

---

## Task 2: Backend — `SetAnchorStatusRequest` model

**Files:**
- Modify: `plnd_api/src/models.rs:1-4` (import) and `:137-140` (new struct)

- [ ] **Step 1: Import the consumption enum**

In `plnd_api/src/models.rs`, add to the top imports (after the `use uuid::Uuid;` line):

```rust
use plnd_data::models::MealConsumptionStatus;
```

- [ ] **Step 2: Add the request model**

Immediately after the existing `PatchEntryStatusRequest` struct (currently ending at line 140), add:

```rust
/// Body for `PATCH /schedule/anchors/{id}/status`. Deserializes directly into
/// the meal-specific `MealConsumptionStatus` enum (serde `snake_case`); an
/// unknown value yields a 422 from the JSON extractor.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct SetAnchorStatusRequest {
    /// "planned" | "consumed" | "skipped".
    #[schema(value_type = String, example = "consumed")]
    pub status: MealConsumptionStatus,
}
```

- [ ] **Step 3: Verify it compiles**

Run: `just verify-build`
Expected: compiles. (`MealConsumptionStatus` derives `Deserialize` + `serde(rename_all="snake_case")`, so this is valid. The `#[schema(value_type = String)]` keeps utoipa from needing `ToSchema` on the `plnd_data` enum.)

- [ ] **Step 4: Commit**

```bash
git -C $(git rev-parse --show-toplevel) add plnd_api/src/models.rs
git -C $(git rev-parse --show-toplevel) commit -m "feat(api): add SetAnchorStatusRequest model (#890)"
```

---

## Task 3: Backend — `set_status` handler + route + OpenAPI

**Files:**
- Modify: `plnd_api/src/routes/schedule_anchors.rs:8-12` (import) and end of file (handler)
- Modify: `plnd_api/src/main.rs:383-386` (route)
- Modify: `plnd_api/src/openapi.rs:13-21` (model import), `:135` (path), `:194` (schema)

- [ ] **Step 1: Import the new request model in the route module**

In `plnd_api/src/routes/schedule_anchors.rs`, extend the `use crate::models::{...}` block:

```rust
use crate::models::{
    CreateScheduleAnchorRequest, ListScheduleAnchorsQuery, SetAnchorStatusRequest,
    UpdateScheduleAnchorRequest,
};
```

- [ ] **Step 2: Add the handler**

Append this handler to `plnd_api/src/routes/schedule_anchors.rs`, immediately before the existing `fn map_repo_error`:

```rust
#[utoipa::path(
    patch,
    path = "/schedule/anchors/{id}/status",
    tag = "Schedule Anchors",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Instance ID")),
    request_body = SetAnchorStatusRequest,
    responses(
        (status = 200, description = "Consumption status updated", body = MealAnchorInstanceResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 422, description = "Invalid status value"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub, id = %id))]
pub async fn set_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(body): Json<SetAnchorStatusRequest>,
) -> Result<Json<MealAnchorInstanceResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Past-date logging is allowed (architecture.md §4.6) — no date guard.
    let row = state
        .repos
        .meal_anchor_instance
        .set_status(id, user_id, body.status)
        .await
        .map_err(map_repo_error)?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(MealAnchorInstanceResponse::from(row)))
}
```

- [ ] **Step 3: Register the route**

In `plnd_api/src/main.rs`, immediately after the existing `/schedule/anchors/{id}` route block (the `patch(...).delete(...)` one), add:

```rust
        .route(
            "/schedule/anchors/{id}/status",
            patch(schedule_anchors::set_status),
        )
```

- [ ] **Step 4: Register OpenAPI path + schema**

In `plnd_api/src/openapi.rs`:

(a) In the `use crate::models::{...}` block, add `SetAnchorStatusRequest,` (insert after `ReadyStatus,`):

```rust
    PlaceTasksRequest, PlanEntryRequest, PostSchedulePlanRequest, ReadyStatus, SetAnchorStatusRequest,
    SlotRef, TaskEntryRequest, TaskEntryResponse, UnplannableReason, UpdateMealPatternEntryRequest,
    UpdateScheduleAnchorRequest,
```

(b) In the `paths(...)` list, after `crate::routes::schedule_anchors::delete,`:

```rust
        crate::routes::schedule_anchors::delete,
        crate::routes::schedule_anchors::set_status,
```

(c) In the `components(schemas(...))` list, after `UpdateScheduleAnchorRequest,`:

```rust
        UpdateScheduleAnchorRequest,
        SetAnchorStatusRequest,
```

- [ ] **Step 5: Verify it compiles**

Run: `just verify-build`
Expected: compiles.

- [ ] **Step 6: Commit**

```bash
git -C $(git rev-parse --show-toplevel) add plnd_api/src/routes/schedule_anchors.rs plnd_api/src/main.rs plnd_api/src/openapi.rs
git -C $(git rev-parse --show-toplevel) commit -m "feat(api): PATCH /schedule/anchors/{id}/status sets consumption (#890)"
```

---

## Task 4: Backend e2e — status-transition coverage

**Files:**
- Modify: `plnd_client/e2e/tests/schedule-anchors-api.e2e.ts`

> Run from `plnd_client/`. The API must be running on :3000 — start it with `just api` in a separate terminal (or run the whole `just verify` at the end). Targeted run: `npx playwright test schedule-anchors-api`.

- [ ] **Step 1: Extend the response interface with the new fields**

In `plnd_client/e2e/tests/schedule-anchors-api.e2e.ts`, add to `interface AnchorResponse` (after `template_entry_id`):

```ts
  template_entry_id: string | null;
  status: string;
  consumed_at: string | null;
  created_at: string;
```

- [ ] **Step 2: Write the failing status test**

Add this test inside the `test.describe(...)` block:

```ts
  test('PATCH status: consumed stamps consumed_at; skipped and revert clear it; bad value 422; unknown id 404', async () => {
    const sub = generateTestSub();
    const headers = await authHeaders(sub);
    const date = isoDate(-1); // yesterday — past-date logging allowed

    const addRes = await fetch(`${API_BASE}/schedule/anchors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ date, name: 'Lunch', preferred_time: '12:00' }),
    });
    const inst = (await addRes.json()) as AnchorResponse;
    expect(inst.status).toBe('planned');
    expect(inst.consumed_at).toBeNull();

    // → consumed
    const consumedRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'consumed' }),
    });
    expect(consumedRes.status).toBe(200);
    const consumed = (await consumedRes.json()) as AnchorResponse;
    expect(consumed.status).toBe('consumed');
    expect(consumed.consumed_at).not.toBeNull();

    // → skipped (clears consumed_at)
    const skippedRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'skipped' }),
    });
    expect(skippedRes.status).toBe(200);
    const skipped = (await skippedRes.json()) as AnchorResponse;
    expect(skipped.status).toBe('skipped');
    expect(skipped.consumed_at).toBeNull();

    // → revert to planned
    const plannedRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'planned' }),
    });
    expect(plannedRes.status).toBe(200);
    expect(((await plannedRes.json()) as AnchorResponse).status).toBe('planned');

    // invalid status value → 422
    const badRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'eaten' }),
    });
    expect(badRes.status).toBe(422);

    // unknown id → 404
    const missingRes = await fetch(
      `${API_BASE}/schedule/anchors/00000000-0000-0000-0000-000000000000/status`,
      { method: 'PATCH', headers, body: JSON.stringify({ status: 'consumed' }) },
    );
    expect(missingRes.status).toBe(404);
  });
```

- [ ] **Step 3: Run the test**

Run (with API up): `cd plnd_client && npx playwright test schedule-anchors-api`
Expected: all tests PASS, including the new one.

- [ ] **Step 4: Commit**

```bash
git -C $(git rev-parse --show-toplevel) add plnd_client/e2e/tests/schedule-anchors-api.e2e.ts
git -C $(git rev-parse --show-toplevel) commit -m "test(e2e): cover anchor status transitions (#890)"
```

---

## Task 5: Frontend — DTO + consumption mapping in the service

**Files:**
- Modify: `plnd_client/src/app/core/models/week-plan.ts:129-140`
- Modify: `plnd_client/src/app/core/services/schedule.service.ts`
- Test: `plnd_client/src/app/core/services/schedule.service.spec.ts`

> Frontend unit runs from the worktree's `plnd_client`: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless`.

- [ ] **Step 1: Add the new DTO fields**

In `plnd_client/src/app/core/models/week-plan.ts`, in `interface MealAnchorInstanceDto`, add after `template_entry_id`:

```ts
  template_entry_id: string | null;
  status: string;            // "planned" | "consumed" | "skipped"
  consumed_at: string | null;
  created_at: string;
```

- [ ] **Step 2: Write the failing service tests**

In `plnd_client/src/app/core/services/schedule.service.spec.ts`:

(a) Add `status: 'planned'` to the `anchorDto` helper's returned object (so it mirrors the real DTO):

```ts
  return {
    id, user_id: 'u1', date, name, preferred_time: '08:00:00',
    tolerance_minutes: 60, sort_order: 0, template_entry_id: null,
    status: 'planned', consumed_at: null,
    created_at: `${date}T08:00:00Z`, updated_at: `${date}T08:00:00Z`,
  };
```

(b) Replace the entire `describe('skipMeal', ...)` block (currently lines ~398-433) with:

```ts
  it('maps a consumed anchor to status done', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [], [{ ...anchorDto('m1', 'breakfast'), status: 'consumed' }]);
    expect((svc.scheduleItems()[0] as MealAnchor).status).toBe('done');
  });

  it('maps a skipped anchor to status skipped', () => {
    svc.loadDay('2026-04-02');
    flushDay(httpMock, [], [{ ...anchorDto('m1', 'breakfast'), status: 'skipped' }]);
    expect((svc.scheduleItems()[0] as MealAnchor).status).toBe('skipped');
  });

  describe('setMealConsumption', () => {
    beforeEach(() => {
      (svc as unknown as { _items: WritableSignal<ScheduleItem[]> })._items.set([{
        id: 'meal-1', name: 'Lunch', emoji: '🥗',
        status: 'planned', description: 'Soup', duringMealTasks: [],
      }]);
    });

    it('PATCHes /schedule/anchors/:id/status with the given status', () => {
      svc.setMealConsumption('meal-1', 'skipped');

      const req = httpMock.expectOne('http://localhost:3000/schedule/anchors/meal-1/status');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'skipped' });
      req.flush({});
    });

    it('optimistically sets skipped in the signal', () => {
      svc.setMealConsumption('meal-1', 'skipped');
      httpMock.expectOne(r => r.url.includes('/schedule/anchors/meal-1/status')).flush({});
      expect((svc.scheduleItems()[0] as MealAnchor).status).toBe('skipped');
    });

    it('optimistically sets done when consumed', () => {
      svc.setMealConsumption('meal-1', 'consumed');
      httpMock.expectOne(r => r.url.includes('/schedule/anchors/meal-1/status')).flush({});
      expect((svc.scheduleItems()[0] as MealAnchor).status).toBe('done');
    });

    it('reverts to planned (has dish) when set to planned', () => {
      svc.setMealConsumption('meal-1', 'planned');
      httpMock.expectOne(r => r.url.includes('/schedule/anchors/meal-1/status')).flush({});
      expect((svc.scheduleItems()[0] as MealAnchor).status).toBe('planned');
    });

    it('reloads the day on HTTP error', () => {
      svc['_date'].set('2026-04-20');
      svc.setMealConsumption('meal-1', 'consumed');
      httpMock.expectOne(r => r.url.includes('/schedule/anchors/meal-1/status'))
        .flush('error', { status: 500, statusText: 'Internal Server Error' });
      flushDay(httpMock); // reload issues period + anchors again
    });
  });

  describe('toggleMealConsumed', () => {
    it('marks consumed when the meal is not done', () => {
      (svc as unknown as { _items: WritableSignal<ScheduleItem[]> })._items.set([{
        id: 'meal-1', name: 'Lunch', emoji: '🥗', status: 'planned', duringMealTasks: [],
      }]);
      svc.toggleMealConsumed('meal-1');
      const req = httpMock.expectOne('http://localhost:3000/schedule/anchors/meal-1/status');
      expect(req.request.body).toEqual({ status: 'consumed' });
      req.flush({});
    });

    it('reverts to planned when the meal is done', () => {
      (svc as unknown as { _items: WritableSignal<ScheduleItem[]> })._items.set([{
        id: 'meal-1', name: 'Lunch', emoji: '🥗', status: 'done', duringMealTasks: [],
      }]);
      svc.toggleMealConsumed('meal-1');
      const req = httpMock.expectOne('http://localhost:3000/schedule/anchors/meal-1/status');
      expect(req.request.body).toEqual({ status: 'planned' });
      req.flush({});
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `setMealConsumption`/`toggleMealConsumed` are not functions; consumed/skipped mapping tests fail.

- [ ] **Step 4: Implement the mapping helper + service methods**

In `plnd_client/src/app/core/services/schedule.service.ts`:

(a) Add an exported type near the top of the file (after the imports):

```ts
export type MealConsumptionApi = 'planned' | 'consumed' | 'skipped';
```

(b) Replace the `skipMeal` method (lines ~93-98) with these two methods:

```ts
  /** Set a meal anchor's consumption status (planned/consumed/skipped). */
  setMealConsumption(id: string, status: MealConsumptionApi): void {
    this._items.update(items =>
      items.map(item =>
        isMealAnchor(item) && item.id === id
          ? { ...item, status: toMealUiStatus(status, item.description) }
          : item,
      ),
    );
    this.http
      .patch(`${this.apiBase}/schedule/anchors/${id}/status`, { status })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
  }

  /** Toggle a meal between consumed and not-consumed (day-view checkbox). */
  toggleMealConsumed(id: string): void {
    const item = this._items().find(i => isMealAnchor(i) && i.id === id) as MealAnchor | undefined;
    if (!item) return;
    this.setMealConsumption(id, item.status === 'done' ? 'planned' : 'consumed');
  }
```

(c) Add the mapping helper in the "API → model mapping" section (e.g. just above `mapAnchorInstance`):

```ts
/**
 * Folds the backend consumption status into the UI `MealAnchor.status`.
 * `consumed` → done, `skipped` → skipped, `planned` falls back to the
 * dish-planning state (a dish title means 'planned', otherwise 'unplanned').
 */
function toMealUiStatus(
  status: string | undefined,
  description?: string,
): MealAnchor['status'] {
  if (status === 'consumed') return 'done';
  if (status === 'skipped') return 'skipped';
  return description ? 'planned' : 'unplanned';
}
```

(d) Update `mapAnchorInstance` to use it — replace its `status:` line:

```ts
    status: toMealUiStatus(dto.status, planned?.title ?? undefined),
    description: planned?.title ?? undefined,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS (including the pre-existing planned/unplanned mapping tests, which still hold because `toMealUiStatus('planned', ...)` reproduces the old behavior).

- [ ] **Step 6: Commit**

```bash
git -C $(git rev-parse --show-toplevel) add plnd_client/src/app/core/models/week-plan.ts plnd_client/src/app/core/services/schedule.service.ts plnd_client/src/app/core/services/schedule.service.spec.ts
git -C $(git rev-parse --show-toplevel) commit -m "feat(client): setMealConsumption targets anchor status endpoint (#890)"
```

---

## Task 6: Frontend — rewire day-view + skipped styling

**Files:**
- Modify: `plnd_client/src/app/features/day-view/day-view.ts:57-64`
- Modify: `plnd_client/src/app/features/day-view/day-view.spec.ts:21-29`
- Modify: `plnd_client/src/app/features/schedule/components/meal-row/meal-row.ts:11`
- Modify: `plnd_client/src/app/features/schedule/components/meal-row/meal-row.scss`
- Test: `plnd_client/src/app/features/schedule/components/meal-row/meal-row.spec.ts`

- [ ] **Step 1: Write the failing meal-row styling test**

In `plnd_client/src/app/features/schedule/components/meal-row/meal-row.spec.ts`, add a skipped fixture and a test:

```ts
const skippedMeal: MealAnchor = {
  id: 'm4', name: 'Dinner', emoji: '🍽',
  status: 'skipped', duringMealTasks: []
};
```

```ts
  it('applies the skipped modifier class for a skipped meal', async () => {
    const f = await setup(skippedMeal);
    const band = f.debugElement.query(By.css('.meal-band')).nativeElement as HTMLElement;
    expect(band.classList).toContain('meal-band--skipped');
  });

  it('does not apply the skipped modifier for a done meal', async () => {
    const f = await setup(doneMeal);
    const band = f.debugElement.query(By.css('.meal-band')).nativeElement as HTMLElement;
    expect(band.classList).not.toContain('meal-band--skipped');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `.meal-band--skipped` class not present.

- [ ] **Step 3: Add the modifier class in the meal-row template**

In `plnd_client/src/app/features/schedule/components/meal-row/meal-row.ts`, change the band element (line 11):

```html
    <div class="meal-band" [class.meal-band--skipped]="meal().status === 'skipped'">
```

- [ ] **Step 4: Add the styling**

Append to `plnd_client/src/app/features/schedule/components/meal-row/meal-row.scss`:

```scss
.meal-band--skipped {
  opacity: 0.6;

  .meal-name {
    text-decoration: line-through;
  }
}
```

- [ ] **Step 5: Rewire the day-view meal handlers**

In `plnd_client/src/app/features/day-view/day-view.ts`, in the `<app-meal-row>` element, change the `(doneToggle)` and `(skipped)` bindings (leave `(toggled)` — during-meal tasks — unchanged):

```html
                <app-meal-row
                  [meal]="item"
                  [date]="scheduleService.date()"
                  (toggled)="scheduleService.toggleItem($event)"
                  (doneToggle)="scheduleService.toggleMealConsumed($event)"
                  (skipped)="scheduleService.setMealConsumption($event, 'skipped')"
                />
```

- [ ] **Step 6: Add service spies to the day-view spec mock**

In `plnd_client/src/app/features/day-view/day-view.spec.ts`, add to the object returned by `makeScheduleServiceMock` (alongside `toggleItem`):

```ts
    loadDay:    jasmine.createSpy('loadDay'),
    toggleItem: jasmine.createSpy('toggleItem'),
    toggleMealConsumed: jasmine.createSpy('toggleMealConsumed'),
    setMealConsumption: jasmine.createSpy('setMealConsumption'),
    addItem:    jasmine.createSpy('addItem'),
```

- [ ] **Step 7: Run all Angular unit tests**

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless`
Expected: PASS.

- [ ] **Step 8: Lint**

Run: `just ts-lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git -C $(git rev-parse --show-toplevel) add plnd_client/src/app/features/day-view/day-view.ts plnd_client/src/app/features/day-view/day-view.spec.ts plnd_client/src/app/features/schedule/components/meal-row/meal-row.ts plnd_client/src/app/features/schedule/components/meal-row/meal-row.scss plnd_client/src/app/features/schedule/components/meal-row/meal-row.spec.ts
git -C $(git rev-parse --show-toplevel) commit -m "feat(client): rewire day-view meal logging + skipped styling (#890)"
```

---

## Task 7: E2E — log a meal from the day view → briefing reflects it

**Files:**
- Create: `plnd_client/e2e/tests/log-meal-briefing.e2e.ts`

> `/briefing/yesterday` is always computed for the server's *yesterday* (`Utc::now().date_naive() - 1 day`), so the test seeds an anchor on yesterday, logs it from `/day/<yesterday>` (past-date edits allowed), then reads the briefing. Run with API up: `cd plnd_client && npx playwright test log-meal-briefing`.

- [ ] **Step 1: Write the acceptance test**

Create `plnd_client/e2e/tests/log-meal-briefing.e2e.ts`:

```ts
import { test, expect } from '@playwright/test';
import { API_BASE, mintTestToken, generateTestSub, injectAuthToken } from '../helpers/auth';
import { seedMealAnchor } from '../helpers/seed-data';
import { DayViewPage } from '../pages/day-view.page';

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test('marking a meal consumed in the day view is reflected in the briefing meals_logged', async ({ page }) => {
  const sub = generateTestSub();
  const yesterday = isoDate(-1);

  // Seed a meal anchor on yesterday (past-date logging is allowed).
  await seedMealAnchor(sub, { date: yesterday, name: 'Lunch', preferred_time: '12:00' });

  await injectAuthToken(page, sub);

  const dayView = new DayViewPage(page);
  await dayView.gotoDate(yesterday);

  const row = dayView.getMealRows().first();
  await expect(row).toBeVisible();
  const checkbox = dayView.getMealRowDoneCheckbox(row);
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  // The briefing snapshot for yesterday should now count the consumed meal.
  const token = await mintTestToken(sub);
  await expect.poll(async () => {
    const res = await fetch(`${API_BASE}/briefing/yesterday`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return -1;
    const body = (await res.json()) as { meals_logged: number };
    return body.meals_logged;
  }).toBeGreaterThanOrEqual(1);
});
```

> Verified helper contracts: `injectAuthToken(page, sub)` is exported from `e2e/helpers/auth.ts` (used by `day-view-review-pane.e2e.ts` and others); `seedMealAnchor(sub, { date, name, preferred_time, tolerance_minutes? })` returns the seeded anchor; `gotoDate`, `getMealRows`, `getMealRowDoneCheckbox` already exist on `DayViewPage`. No new helpers required.

- [ ] **Step 2: Run the test**

Run (with API up): `cd plnd_client && npx playwright test log-meal-briefing`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C $(git rev-parse --show-toplevel) add plnd_client/e2e/tests/log-meal-briefing.e2e.ts
git -C $(git rev-parse --show-toplevel) commit -m "test(e2e): log meal in day view reflects in briefing meals_logged (#890)"
```

---

## Task 8: Full verification + PR

- [ ] **Step 1: Run the full gate**

Run: `just verify`
Expected: all quality + build + unit + e2e pass.

- [ ] **Step 2: Rebase onto origin/main**

```bash
git -C $(git rev-parse --show-toplevel) fetch origin
git -C $(git rev-parse --show-toplevel) rebase origin/main
```

- [ ] **Step 3: Request code review** (superpowers:requesting-code-review) before pushing.

- [ ] **Step 4: Push + open PR**

```bash
git -C $(git rev-parse --show-toplevel) push --force-with-lease -u origin feat/890-log-meal-consumed
gh pr create --title "feat(meals): log a meal as consumed/skipped (#890)" --body "Closes #890"
```

- [ ] **Step 5:** Invoke the `monitor-pr` skill to watch CI and address review.

---

## Notes / decisions baked in

- **Status code for invalid value:** relying on axum's `Json` extractor rejecting an unknown enum variant as `422 Unprocessable Entity` (data error). Task 4 asserts 422; if the runtime returns 400 instead, adjust the assertion and add an explicit guard.
- **Revert semantics:** unchecking a consumed meal sets `planned`; the optimistic UI status becomes `planned` when the row has a dish title, else `unplanned` — matching `mapAnchorInstance`.
- **Out of scope:** merging planned-dish info beyond what already exists (#479); the during-meal task checkbox path (`toggleItem`) is untouched.
