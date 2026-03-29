# Planning Wizard Step 2 E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Playwright e2e tests for Planning Wizard Step 2 (Tasks Planning) covering accordion rendering, task add/remove, and the floating tasks panel.

**Architecture:** All tests live in a single `test.describe('Step 2 — Tasks Planning')` block appended to the existing `planning-wizard.e2e.ts`. A shared `beforeEach` injects a `plnd:plan-draft` via `addInitScript` (pre-seeding two tasks on day 1 and navigating directly to Step 2), then verifies the correct step is active before each test.

**Tech Stack:** Playwright (`@playwright/test` ^1.58.2), Angular, `just` task runner.

---

## File Map

| Action | Path |
|---|---|
| Modify | `plnd_client/e2e/tests/planning-wizard.e2e.ts` |

No new files are created. All changes are appended after the existing `Cancel flow` describe block, inside the top-level `test.describe('Planning Wizard', ...)`.

---

## Running Tests

**Dev mode** (requires `ng serve` running on localhost:4200):
```bash
cd plnd_client && npx playwright test e2e/tests/planning-wizard.e2e.ts --project=chromium --reporter=line
```

**CI mode** (full Docker stack):
```bash
just test-e2e
```

---

## Task 1: Skeleton + `beforeEach`

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard.e2e.ts`

- [ ] **Step 1: Append the describe block skeleton with `beforeEach`**

Add this block at the bottom of the top-level `test.describe('Planning Wizard', ...)`, after the closing `});` of the `Cancel flow` block (before the final `});`):

```ts
  // ── Step 2 — Tasks Planning ───────────────────────────────────────────────

  test.describe('Step 2 — Tasks Planning', () => {
    const MOCK_TASKS = [
      { title: 'Morning run', energy: 'high', date: '2026-03-30', task_type: 'custom' },
      { title: 'Read book',   energy: 'low',  date: '2026-03-30', task_type: 'custom' },
    ];

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime('2026-03-28T00:00:00');
      await page.addInitScript((tasks) => {
        localStorage.setItem('plnd:plan-draft', JSON.stringify({
          schemaVersion: 1,
          planStart: '2026-03-30',
          planEnd: '2026-04-05',
          currentStep: 2,
          carryoverDecisions: {},
          scheduledMeals: {},
          scheduledTasks: tasks,
          floatingTasks: [],
          savedAt: '2026-03-29T00:00:00.000Z',
        }));
      }, MOCK_TASKS);
      await seedWizard(page);
      await page.goto('/plan/week');
      await expect(page.locator('.planning-wizard')).toBeVisible();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');
    });

  });
```

- [ ] **Step 2: Run and verify the file has no syntax errors**

```bash
cd plnd_client && npx tsc --noEmit --project tsconfig.json 2>&1 | grep "e2e"
```

Expected: no output (no errors in the e2e files).

---

## Task 2: Accordion structure tests (count + header content)

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard.e2e.ts`

- [ ] **Step 1: Add the two accordion structure tests inside the describe block**

Insert before the closing `});` of `Step 2 — Tasks Planning`:

```ts
    test('daily accordions render one entry per horizon day', async ({ page }) => {
      await expect(page.locator('.day-accordion')).toHaveCount(7);
    });

    test('accordion header shows day name, date, and task count badge', async ({ page }) => {
      const first = page.locator('.day-accordion').nth(0);
      await expect(first.locator('.day-name')).toHaveText('MON');
      await expect(first.locator('.day-date')).toContainText('Mar 30');
      await expect(first.locator('.task-badge')).toHaveText('2 tasks');

      const second = page.locator('.day-accordion').nth(1);
      await expect(second.locator('.task-badge')).toHaveText('0 tasks');
    });
```

- [ ] **Step 2: Run the two new tests and verify they pass**

```bash
cd plnd_client && npx playwright test e2e/tests/planning-wizard.e2e.ts --project=chromium --reporter=line -g "Step 2"
```

Expected: 2 tests pass.

---

## Task 3: Accordion toggle test

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard.e2e.ts`

- [ ] **Step 1: Add the toggle test**

Insert inside `Step 2 — Tasks Planning`, after the header test:

```ts
    test('clicking accordion header collapses and re-expands it', async ({ page }) => {
      const first = page.locator('.day-accordion').nth(0);
      // Horizon ≤ 7 → auto-expanded on load
      await expect(first).toHaveClass(/open/);

      // Click to collapse
      await first.locator('.day-accordion__header').click();
      await expect(first).not.toHaveClass(/open/);

      // Click to re-expand
      await first.locator('.day-accordion__header').click();
      await expect(first).toHaveClass(/open/);
    });
```

- [ ] **Step 2: Run Step 2 tests and verify 3 pass**

```bash
cd plnd_client && npx playwright test e2e/tests/planning-wizard.e2e.ts --project=chromium --reporter=line -g "Step 2"
```

Expected: 3 tests pass.

---

## Task 4: Task row content test

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard.e2e.ts`

- [ ] **Step 1: Add the task row content test**

Insert inside `Step 2 — Tasks Planning`:

```ts
    test('task row shows title and energy level badge', async ({ page }) => {
      const first = page.locator('.day-accordion').nth(0);
      const rows = first.locator('.task-row');
      await expect(rows).toHaveCount(2);

      await expect(rows.nth(0).locator('.task-title')).toHaveText('Morning run');
      await expect(rows.nth(0).locator('.energy-badge.energy-high')).toBeVisible();

      await expect(rows.nth(1).locator('.task-title')).toHaveText('Read book');
      await expect(rows.nth(1).locator('.energy-badge.energy-low')).toBeVisible();
    });
```

- [ ] **Step 2: Run Step 2 tests and verify 4 pass**

```bash
cd plnd_client && npx playwright test e2e/tests/planning-wizard.e2e.ts --project=chromium --reporter=line -g "Step 2"
```

Expected: 4 tests pass.

---

## Task 5: Add task to a specific day test

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard.e2e.ts`

- [ ] **Step 1: Add the add-task test**

Insert inside `Step 2 — Tasks Planning`:

```ts
    test('adding a task to a day appends it to that day list', async ({ page }) => {
      // Target the second accordion (2026-03-31) — starts empty
      const second = page.locator('.day-accordion').nth(1);
      const addAffordance = second.locator('.add-affordance');

      await addAffordance.locator('.add-row').click();
      await addAffordance.locator('.entry-input').fill('Walk the dog');
      await addAffordance.locator('.btn-add').click();

      const rows = second.locator('.task-row');
      await expect(rows).toHaveCount(1);
      await expect(rows.nth(0).locator('.task-title')).toHaveText('Walk the dog');
      await expect(rows.nth(0).locator('.energy-badge')).toBeVisible();
    });
```

- [ ] **Step 2: Run Step 2 tests and verify 5 pass**

```bash
cd plnd_client && npx playwright test e2e/tests/planning-wizard.e2e.ts --project=chromium --reporter=line -g "Step 2"
```

Expected: 5 tests pass.

---

## Task 6: Remove task test

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard.e2e.ts`

- [ ] **Step 1: Add the remove-task test**

Insert inside `Step 2 — Tasks Planning`:

```ts
    test('remove button removes a task from the day list', async ({ page }) => {
      const first = page.locator('.day-accordion').nth(0);
      const rows = first.locator('.task-row');
      await expect(rows).toHaveCount(2);

      // Remove the first task ("Morning run")
      await rows.nth(0).locator('.task-remove').click();

      await expect(rows).toHaveCount(1);
      await expect(rows.nth(0).locator('.task-title')).toHaveText('Read book');
    });
```

- [ ] **Step 2: Run Step 2 tests and verify 6 pass**

```bash
cd plnd_client && npx playwright test e2e/tests/planning-wizard.e2e.ts --project=chromium --reporter=line -g "Step 2"
```

Expected: 6 tests pass.

---

## Task 7: Floating panel tests (render + add)

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard.e2e.ts`

- [ ] **Step 1: Add the two floating panel tests**

Insert inside `Step 2 — Tasks Planning`:

```ts
    test('floating tasks panel renders with floating title and hint', async ({ page }) => {
      await expect(page.locator('.floating-panel')).toBeVisible();
      await expect(page.locator('.floating-title')).toContainText('FLOATING TASKS');
      await expect(page.locator('.floating-hint')).toBeVisible();
    });

    test('adding a floating task appends it to the floating list', async ({ page }) => {
      const floatAdd = page.locator('.float-add-affordance');

      await floatAdd.locator('.add-row').click();
      await floatAdd.locator('.entry-input').fill('Buy groceries');
      await floatAdd.locator('.btn-add').click();

      const rows = page.locator('.floating-task-row');
      await expect(rows).toHaveCount(1);
      await expect(rows.nth(0).locator('.task-title')).toHaveText('Buy groceries');
      await expect(rows.nth(0).locator('.floating-badge')).toBeVisible();
    });
```

- [ ] **Step 2: Run all Step 2 tests and verify all 8 pass**

```bash
cd plnd_client && npx playwright test e2e/tests/planning-wizard.e2e.ts --project=chromium --reporter=line -g "Step 2"
```

Expected: 8 tests pass.

---

## Task 8: Full suite run + commit

**Files:**
- No changes — verification and commit only.

- [ ] **Step 1: Run the full planning-wizard test file to verify no regressions**

```bash
cd plnd_client && npx playwright test e2e/tests/planning-wizard.e2e.ts --project=chromium --reporter=line
```

Expected: all tests in the file pass (guard tests + nav tests + Step 1 tests + cancel test + 8 new Step 2 tests).

- [ ] **Step 2: Run the full quality check**

```bash
just verify
```

Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/tests/planning-wizard.e2e.ts
git commit -m "test(e2e): Planning Wizard — Step 2 Tasks Planning (#105)"
```

---

## Notes for the implementer

- `addInitScript(fn, arg)` passes `arg` as the first parameter to `fn`. The `MOCK_TASKS` constant is defined outside `beforeEach` and passed as the second argument so the init script function has no closure over test scope.
- The `.open` CSS class on `.day-accordion` is the reliable expanded-state selector — it controls both the chevron rotation and the `max-height` transition in the component's styles.
- Energy badge for `'medium'` renders as `"med"` (per the component template: `task.energy === 'medium' ? 'med' : task.energy`). The pre-seeded tasks use `'high'` and `'low'` to avoid this detail in the badge text assertions.
- Locators are scoped to their parent accordion via `.nth(index).locator(...)` to avoid cross-accordion interference when multiple `app-add-entry` components are on the page simultaneously.
