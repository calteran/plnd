# Day View — Add Entry E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright E2E tests covering the `AddEntryComponent` smart form — open/close behavior, type detection (exercise/appointment/task), and two `test.fail()` placeholders for deferred features.

**Architecture:** Extend `DayViewPage` with add-entry locator helpers, then write a focused `day-view-add-entry.e2e.ts` test file. All tests authenticate via `seedAuth` and wait for the schedule list before interacting with the form (the component only renders inside `.schedule-list`).

**Tech Stack:** Playwright, TypeScript, Angular (standalone components), `just test-e2e-dev` for local runs

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `plnd_client/e2e/pages/day-view.page.ts` | Add add-entry locator helpers + `openAddEntry()` |
| Create | `plnd_client/e2e/tests/day-view-add-entry.e2e.ts` | All add-entry E2E scenarios |

---

### Task 1: Extend `DayViewPage` with add-entry helpers

**Files:**
- Modify: `plnd_client/e2e/pages/day-view.page.ts`

- [ ] **Step 1: Add the helper methods**

Open `plnd_client/e2e/pages/day-view.page.ts`. The current file ends at line 32. Replace the closing brace with the extended version:

```typescript
import { Page } from '@playwright/test';

export class DayViewPage {
  constructor(private readonly page: Page) {}

  async goto() { await this.page.goto('/today'); }
  async gotoDate(date: string) { await this.page.goto(`/day/${date}`); }
  getHeading() { return this.page.locator('.schedule-view'); }

  // Day header
  getDateText() { return this.page.locator('.date-text'); }
  getPrevButton() { return this.page.getByRole('button', { name: 'Previous day' }); }
  getNextButton() { return this.page.getByRole('button', { name: 'Next day' }); }
  getTodayBadge() { return this.page.locator('.today-badge'); }

  // Schedule states
  getScheduleList() { return this.page.locator('.schedule-list'); }
  getSkeletonList() { return this.page.getByLabel('Loading schedule'); }
  getEmptyState() { return this.page.locator('.empty-state'); }
  getErrorState() { return this.page.getByRole('alert'); }
  getRetryButton() { return this.page.getByRole('button', { name: /retry/i }); }

  // Schedule row items
  getMealRows() { return this.page.locator('app-meal-row'); }
  getTaskRows() { return this.page.locator('.schedule-list > app-task-row'); }

  // Add-entry form
  getAddRow() { return this.page.locator('.add-row'); }
  getEntryInput() { return this.page.locator('.entry-input'); }
  getMorphExercise() { return this.page.locator('.morph-form--exercise'); }
  getMorphAppointment() { return this.page.locator('.morph-form--appointment'); }
  getAddButton() { return this.page.locator('button.btn-add'); }
  getCancelButton() { return this.page.locator('button.btn-cancel'); }

  /** Click "Add something…" and wait for the text input to appear. */
  async openAddEntry() {
    await this.getAddRow().click();
    await this.getEntryInput().waitFor({ state: 'visible' });
  }

  /** Open the avatar dropdown then click Sign out. */
  async signOut() {
    await this.page.locator('.avatar-btn').click();
    await this.page.getByRole('menuitem', { name: 'Sign out' }).click();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd plnd_client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/pages/day-view.page.ts
git commit -m "test(e2e): extend DayViewPage with add-entry helpers"
```

---

### Task 2: Scaffold the new test file with shared setup

**Files:**
- Create: `plnd_client/e2e/tests/day-view-add-entry.e2e.ts`

- [ ] **Step 1: Create the file with auth boilerplate**

```typescript
import { test, expect, Page } from '@playwright/test';
import { DayViewPage } from '../pages/day-view.page';

// ── Shared mock fixtures ────────────────────────────────────────────────────

const API_BASE = 'http://localhost:3000';

const MOCK_USER_ONBOARDED = {
  user_id: 'e2e-test-uuid',
  email: 'testuser@mock.plnd',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: true,
};

const MOCK_PREFS = {
  user_id: 'e2e-test-uuid',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  week_start_day: 1,
  planning_trigger_offset: 0,
  default_plan_length_days: 7,
};

// ── Auth helper ─────────────────────────────────────────────────────────────

async function seedAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'synthetic.test.token');
  });
  await page.route(`${API_BASE}/users/me`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
  );
  await page.route(`${API_BASE}/preferences/me`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
  );
  await page.route(`${API_BASE}/schedule/plan/status**`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ planned: false }) })
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Day View — Add Entry', () => {

  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
  });

  // Tests go here (Tasks 3–5)

});
```

Save to `plnd_client/e2e/tests/day-view-add-entry.e2e.ts`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd plnd_client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/tests/day-view-add-entry.e2e.ts
git commit -m "test(e2e): scaffold day-view-add-entry test file"
```

---

### Task 3: Open/close behavior tests

The `app-add-entry` component renders inside `.schedule-list`, which only appears when `scheduleItems.length > 0`. `ScheduleService.loadDay()` uses a `setTimeout`-based mock that always provides items — wait for `getScheduleList()` before asserting the add-entry trigger.

**Files:**
- Modify: `plnd_client/e2e/tests/day-view-add-entry.e2e.ts`

- [ ] **Step 1: Add open/close tests inside the `test.describe` block**

Replace the `// Tests go here (Tasks 3–5)` comment with:

```typescript
  test.describe('open / close', () => {
    test('"Add something…" row is visible in the schedule list', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await expect(dayView.getAddRow()).toBeVisible();
    });

    test('clicking "Add something…" opens the entry input', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await expect(dayView.getEntryInput()).toBeVisible();
      // "Add something…" trigger row should no longer be visible
      await expect(dayView.getAddRow()).not.toBeVisible();
    });

    test('Cancel button closes the form and "Add something…" row reappears', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().fill('some text');
      await dayView.getCancelButton().click();
      await expect(dayView.getEntryInput()).not.toBeVisible();
      await expect(dayView.getAddRow()).toBeVisible();
    });

    test('Escape key closes the form', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().press('Escape');
      await expect(dayView.getEntryInput()).not.toBeVisible();
      await expect(dayView.getAddRow()).toBeVisible();
    });

    test('Add button is disabled when input is empty', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await expect(dayView.getAddButton()).toBeDisabled();
    });
  });

  // Tasks 4–5 tests go here
```

- [ ] **Step 2: Run just the new tests to see them pass**

```bash
cd plnd_client && npx playwright test e2e/tests/day-view-add-entry.e2e.ts --grep "open / close"
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/tests/day-view-add-entry.e2e.ts
git commit -m "test(e2e): add open/close behavior tests for AddEntryComponent"
```

---

### Task 4: Type-detection tests

**Files:**
- Modify: `plnd_client/e2e/tests/day-view-add-entry.e2e.ts`

- [ ] **Step 1: Add type-detection tests after the `open / close` describe block**

Replace the `// Tasks 4–5 tests go here` comment with:

```typescript
  test.describe('smart type detection', () => {
    async function openAndType(page: import('@playwright/test').Page, text: string) {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().fill(text);
      return dayView;
    }

    test('exercise keyword shows duration field', async ({ page }) => {
      const dayView = await openAndType(page, 'yoga for a bit');
      await expect(dayView.getMorphExercise()).toBeVisible();
      await expect(dayView.getMorphAppointment()).not.toBeVisible();
      await expect(dayView.getMorphExercise().locator('[aria-label="Duration in minutes"]')).toBeVisible();
    });

    test('time pattern shows appointment fields (time picker + location)', async ({ page }) => {
      const dayView = await openAndType(page, 'dentist 2pm');
      await expect(dayView.getMorphAppointment()).toBeVisible();
      await expect(dayView.getMorphExercise()).not.toBeVisible();
      await expect(dayView.getMorphAppointment().locator('[aria-label="Appointment time"]')).toBeVisible();
      await expect(dayView.getMorphAppointment().locator('[aria-label="Location"]')).toBeVisible();
    });

    test('generic text shows no morph fields (task default)', async ({ page }) => {
      const dayView = await openAndType(page, 'call mum');
      await expect(dayView.getMorphExercise()).not.toBeVisible();
      await expect(dayView.getMorphAppointment()).not.toBeVisible();
    });
  });

  // Task 5 tests go here
```

- [ ] **Step 2: Run type-detection tests**

```bash
cd plnd_client && npx playwright test e2e/tests/day-view-add-entry.e2e.ts --grep "smart type detection"
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/tests/day-view-add-entry.e2e.ts
git commit -m "test(e2e): add type-detection tests for AddEntryComponent"
```

---

### Task 5: Deferred-feature placeholder tests

These tests are expected to fail until the noted TODO items are completed. They document the intended future behavior and follow the same `test.fail()` convention already used in `day-view.e2e.ts`.

**Files:**
- Modify: `plnd_client/e2e/tests/day-view-add-entry.e2e.ts`

- [ ] **Step 1: Add placeholder tests after the `smart type detection` describe block**

Replace the `// Task 5 tests go here` comment with:

```typescript
  test.describe('deferred features', () => {
    test('parse hint updates based on detected type', async ({ page }) => {
      // TODO: remove test.fail() when parseHint() is implemented (LLM integration, Phase 3)
      test.fail();
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().fill('yoga');
      await expect(page.locator('.parse-hint')).toBeVisible();
      await expect(page.locator('.parse-hint')).toContainText(/exercise/i);
    });

    test('submitting the form adds the entry to the schedule list', async ({ page }) => {
      // TODO: remove test.fail() when DayViewComponent.onItemAdded() is implemented
      test.fail();
      const MOCK_CREATED_ENTRY = {
        id: 'new-entry-1',
        type: 'task',
        label: 'call mum',
        status: 'pending',
      };
      await page.route(`${API_BASE}/schedule**`, route => {
        if (route.request().method() === 'POST') {
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_CREATED_ENTRY),
          });
        }
        return route.continue();
      });
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().fill('call mum');
      await dayView.getAddButton().click();
      await expect(dayView.getScheduleList()).toContainText('call mum');
    });
  });
```

- [ ] **Step 2: Run the full test file and verify counts**

```bash
cd plnd_client && npx playwright test e2e/tests/day-view-add-entry.e2e.ts
```

Expected output (approximate):
```
8 passed, 2 failed (expected)
```
The 2 failures should be the `deferred features` tests, marked with `test.fail()` so Playwright reports them as expected failures (shown as "passed" in the summary with a note).

> Note: Playwright treats `test.fail()` tests that actually fail as _expected failures_ — they show as passed in the final count. If a `test.fail()` test unexpectedly passes, Playwright reports it as a test failure. So you should see **10 passed** total once the deferred features remain broken.

- [ ] **Step 3: Run the full E2E suite to confirm no regressions**

```bash
just test-e2e-dev
```

Expected: all previously-passing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add plnd_client/e2e/tests/day-view-add-entry.e2e.ts
git commit -m "test(e2e): add deferred-feature placeholder tests for AddEntryComponent"
```

---

### Task 6: Final verification and PR

- [ ] **Step 1: Run `just verify`**

```bash
just verify
```

Expected: passes cleanly (fmt, clippy, deny, machete, ts-lint, ts-deps, verify-build, test-ci).

- [ ] **Step 2: Open a PR**

```bash
gh pr create \
  --title "test(e2e): Day View — Add Entry smart form (#101)" \
  --body "$(cat <<'EOF'
## Summary

- Extends `DayViewPage` with add-entry locator helpers (`getAddRow`, `getEntryInput`, `getMorphExercise`, `getMorphAppointment`, `getAddButton`, `getCancelButton`, `openAddEntry`)
- Adds `e2e/tests/day-view-add-entry.e2e.ts` with 8 active tests (open/close behavior + smart type detection) and 2 `test.fail()` placeholders for deferred features (parse hints, submission result)

## Test plan

- [ ] `just verify` passes cleanly
- [ ] `npx playwright test e2e/tests/day-view-add-entry.e2e.ts` — 10 passed (8 active + 2 expected failures)
- [ ] No regressions in existing `day-view.e2e.ts` tests

Closes #101

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- ✅ "Add something…" button opens form → Task 3 test 1 & 2
- ✅ Exercise detection (keyword → duration field) → Task 4 test 1
- ✅ Appointment detection (time pattern → time + location fields) → Task 4 test 2
- ✅ Default task (generic text → no extra fields) → Task 4 test 3
- ✅ Parse hint updates → Task 5 `test.fail()` placeholder
- ✅ Cancel closes form → Task 3 test 3
- ✅ Add button submits (appears in list) → Task 5 `test.fail()` placeholder
- ✅ Mock intercept for POST → included in Task 5 deferred test
- ✅ `MOCK_USER_ONBOARDED` + authenticated session → `seedAuth` in Task 2

**Placeholder scan:** No TBDs, no "similar to Task N" shortcuts, all code blocks complete.

**Type consistency:** `DayViewPage` methods defined in Task 1 (`getAddRow`, `getEntryInput`, `getMorphExercise`, `getMorphAppointment`, `getAddButton`, `getCancelButton`, `openAddEntry`) are used by that exact name in Tasks 3–5. `openAndType` helper defined and used within Task 4 only.
