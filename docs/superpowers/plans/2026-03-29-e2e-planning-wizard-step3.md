# E2E: Planning Wizard Step 3 Meals Planning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright e2e coverage for Step 3 of the Planning Wizard (the meals grid), closing issue #106.

**Architecture:** A single new test file seeds `plnd:plan-draft` in localStorage with `currentStep: 3` and a compact 3-day horizon (Mon 2026-03-30 → Wed 2026-04-01), navigates to `/plan/week`, and asserts against the live Angular component. Two autocomplete scenarios are marked `test.fail()` because the feature is not yet implemented (phase-3 TODO in `week-plan.ts`).

**Tech Stack:** Playwright, TypeScript, Angular (selectors from `plan-meals-step.ts` component), existing `seedWizard` + `seedAuth` helpers from `plnd_client/e2e/helpers/auth.ts`.

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `plnd_client/e2e/tests/planning-wizard-step3.e2e.ts` | **Create** | All Step 3 e2e scenarios |
| `plnd_client/e2e/tests/planning-wizard.e2e.ts` | **No change** | Existing guards/nav/steps 1–2 stay put |

---

### Task 1: Scaffold the new test file with seed helper and grid structure tests

**Files:**
- Create: `plnd_client/e2e/tests/planning-wizard-step3.e2e.ts`

- [ ] **Step 1: Create the file with imports, seed helper, and `describe` shell**

```typescript
import { test, expect, Page } from '@playwright/test';
import { seedAuth, API_BASE } from '../helpers/auth';

// Fixed seed: 3-day horizon Mon 2026-03-30 → Wed 2026-04-01
// currentStep: 3 → wizard opens directly on the Meals step

async function seedWizard(page: Page): Promise<void> {
  await seedAuth(page);
  await page.route(`${API_BASE}/tasks/weekly-plan**`, route =>
    route.fulfill({ status: 200, json: { task_id: 'test-planning-task' } })
  );
  await page.route(`${API_BASE}/schedule/period**`, route =>
    route.fulfill({ status: 200, json: { carryover: [], entries: [] } })
  );
}

async function seedStep3(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('plnd:plan-draft', JSON.stringify({
      schemaVersion: 1,
      planStart: '2026-03-30',
      planEnd: '2026-04-01',
      currentStep: 3,
      carryoverDecisions: {},
      scheduledMeals: {},
      scheduledTasks: [],
      floatingTasks: [],
      savedAt: '2026-03-29T00:00:00.000Z',
    }));
  });
  await seedWizard(page);
}

test.describe('Planning Wizard — Step 3: Meals Planning', () => {
  // tests go here
});
```

- [ ] **Step 2: Add the `beforeEach` and grid structure tests inside the `describe` block**

Replace the comment `// tests go here` with:

```typescript
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedStep3(page);
    await page.goto('/plan/week');
    await expect(page.locator('.planning-wizard')).toBeVisible();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('3');
  });

  // ── Grid structure ───────────────────────────────────────────────────────────

  test.describe('Grid structure', () => {
    test('meals-grid renders 3 day column headers', async ({ page }) => {
      await expect(page.locator('.cell-day-header')).toHaveCount(3);
    });

    test('meals-grid renders 3 slot row labels', async ({ page }) => {
      await expect(page.locator('.cell-slot-label')).toHaveCount(3);
    });

    test('meals-grid renders 9 cells total (3 days × 3 slots)', async ({ page }) => {
      await expect(page.locator('.gc')).toHaveCount(9);
    });
  });
```

- [ ] **Step 3: Run tests to confirm they can be found (they may fail until the app is up — structure check only)**

```bash
cd /Users/robert/Development/plnd
npx playwright test e2e/tests/planning-wizard-step3.e2e.ts --reporter=list 2>&1 | head -40
```

Expected: test names listed; any failures are infra/app issues, not authoring issues.

- [ ] **Step 4: Commit**

```bash
git add plnd_client/e2e/tests/planning-wizard-step3.e2e.ts
git commit -m "test(e2e): scaffold Step 3 meals grid structure tests"
```

---

### Task 2: Day header content tests

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard-step3.e2e.ts`

- [ ] **Step 1: Add day header tests inside the outer `describe` block (after Grid structure describe)**

```typescript
  // ── Day headers ──────────────────────────────────────────────────────────────

  test.describe('Day headers', () => {
    test('headers show correct day names: Mon, Tue, Wed', async ({ page }) => {
      const headers = page.locator('.cell-day-header');
      await expect(headers.nth(0).locator('.day-name')).toHaveText('Mon');
      await expect(headers.nth(1).locator('.day-name')).toHaveText('Tue');
      await expect(headers.nth(2).locator('.day-name')).toHaveText('Wed');
    });

    test('headers show correct dates: Mar 30, Mar 31, Apr 1', async ({ page }) => {
      const headers = page.locator('.cell-day-header');
      await expect(headers.nth(0).locator('.day-date')).toContainText('Mar 30');
      await expect(headers.nth(1).locator('.day-date')).toContainText('Mar 31');
      await expect(headers.nth(2).locator('.day-date')).toContainText('Apr 1');
    });
  });
```

- [ ] **Step 2: Commit**

```bash
git add plnd_client/e2e/tests/planning-wizard-step3.e2e.ts
git commit -m "test(e2e): add Step 3 day header content tests"
```

---

### Task 3: Pending cell interaction tests

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard-step3.e2e.ts`

- [ ] **Step 1: Add pending cell interaction tests (after Day headers describe)**

The first `.gc` is Mon/Breakfast — always pending because `scheduledMeals: {}` in the seed.

```typescript
  // ── Pending cell interaction ──────────────────────────────────────────────────

  test.describe('Pending cell interaction', () => {
    test('a pending cell shows gc-pick and gc-suggest buttons', async ({ page }) => {
      const cell = page.locator('.gc').first();
      await expect(cell.locator('.gc-pick')).toBeVisible();
      await expect(cell.locator('.gc-suggest')).toBeVisible();
    });

    test('clicking gc-pick opens the inline editor', async ({ page }) => {
      const cell = page.locator('.gc').first();
      await cell.locator('.gc-pick').click();
      await expect(cell).toHaveClass(/gc-editing/);
      await expect(cell.locator('.mock-input')).toBeVisible();
    });

    test('typing a name and pressing Enter fills the cell with custom-g state', async ({ page }) => {
      const cell = page.locator('.gc').first();
      await cell.locator('.gc-pick').click();
      await cell.locator('.mock-input').fill('Greek yogurt');
      await cell.locator('.mock-input').press('Enter');
      await expect(cell).toHaveClass(/custom-g/);
      await expect(cell.locator('.gc-text.custom-t')).toHaveText('Greek yogurt');
    });

    test('pressing Escape cancels edit without saving', async ({ page }) => {
      const cell = page.locator('.gc').first();
      await cell.locator('.gc-pick').click();
      await cell.locator('.mock-input').fill('Should not save');
      await cell.locator('.mock-input').press('Escape');
      await expect(cell).not.toHaveClass(/gc-editing/);
      await expect(cell.locator('.gc-pick')).toBeVisible();
      await expect(cell.locator('.gc-text.custom-t')).not.toBeVisible();
    });
  });
```

- [ ] **Step 2: Commit**

```bash
git add plnd_client/e2e/tests/planning-wizard-step3.e2e.ts
git commit -m "test(e2e): add Step 3 pending cell interaction tests"
```

---

### Task 4: Custom meal cell and skip/undo tests

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard-step3.e2e.ts`

- [ ] **Step 1: Add custom meal cell tests (after Pending cell interaction describe)**

```typescript
  // ── Custom meal cell ─────────────────────────────────────────────────────────

  test.describe('Custom meal cell', () => {
    test('a filled cell shows the meal title in gc-text.custom-t', async ({ page }) => {
      const cell = page.locator('.gc').first();
      // Fill via the editor
      await cell.locator('.gc-pick').click();
      await cell.locator('.mock-input').fill('Avocado toast');
      await cell.locator('.mock-input').press('Enter');
      await expect(cell.locator('.gc-text.custom-t')).toHaveText('Avocado toast');
    });

    test('clicking gc-x on a custom cell clears it back to pending', async ({ page }) => {
      const cell = page.locator('.gc').first();
      // First fill the cell
      await cell.locator('.gc-pick').click();
      await cell.locator('.mock-input').fill('Avocado toast');
      await cell.locator('.mock-input').press('Enter');
      await expect(cell).toHaveClass(/custom-g/);
      // Then clear it
      await cell.locator('.gc-x').click();
      await expect(cell).not.toHaveClass(/custom-g/);
      await expect(cell.locator('.gc-pick')).toBeVisible();
    });
  });
```

- [ ] **Step 2: Add skip/undo tests (after Custom meal cell describe)**

```typescript
  // ── Skip / undo ───────────────────────────────────────────────────────────────

  test.describe('Skip / undo', () => {
    test('clicking gc-x on a pending cell applies skipped-g and shows "— skipped"', async ({ page }) => {
      const cell = page.locator('.gc').first();
      await cell.locator('.gc-x').click();
      await expect(cell).toHaveClass(/skipped-g/);
      await expect(cell.locator('.gc-text.skip-t')).toContainText('— skipped');
    });

    test('clicking gc-undo on a skipped cell restores pending state', async ({ page }) => {
      const cell = page.locator('.gc').first();
      await cell.locator('.gc-x').click();
      await expect(cell).toHaveClass(/skipped-g/);
      await cell.locator('.gc-undo').click();
      await expect(cell).not.toHaveClass(/skipped-g/);
      await expect(cell.locator('.gc-pick')).toBeVisible();
    });
  });
```

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/tests/planning-wizard-step3.e2e.ts
git commit -m "test(e2e): add Step 3 custom meal and skip/undo tests"
```

---

### Task 5: Persistence and autocomplete (test.fail) tests

**Files:**
- Modify: `plnd_client/e2e/tests/planning-wizard-step3.e2e.ts`

- [ ] **Step 1: Add persistence test (after Skip/undo describe)**

```typescript
  // ── Persistence ───────────────────────────────────────────────────────────────

  test('meals state survives navigating to Step 4 and back to Step 3', async ({ page }) => {
    const cell = page.locator('.gc').first();
    // Fill Mon/Breakfast
    await cell.locator('.gc-pick').click();
    await cell.locator('.mock-input').fill('Overnight oats');
    await cell.locator('.mock-input').press('Enter');
    await expect(cell).toHaveClass(/custom-g/);

    // Navigate to Step 4
    await page.getByLabel('Next step').click();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('4');

    // Navigate back to Step 3
    await page.getByLabel('Previous step').click();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('3');

    // Meal should still be set
    await expect(page.locator('.gc').first()).toHaveClass(/custom-g/);
    await expect(page.locator('.gc').first().locator('.gc-text.custom-t')).toHaveText('Overnight oats');
  });
```

- [ ] **Step 2: Add autocomplete test.fail() tests (after persistence test, still inside outer describe)**

These must use `test.fail()` — the component has no autocomplete (plain `<input>` only, see `TODO(phase-3)` in `week-plan.ts`). `test.fail()` documents intent and will start passing once autocomplete ships.

```typescript
  // ── Autocomplete — test.fail() (phase-3) ─────────────────────────────────────
  // These tests are expected to FAIL until autocomplete is implemented.
  // When they start passing, remove test.fail() and the comment.

  test.fail('typing in mock-input shows a suggestion dropdown', async ({ page }) => {
    const cell = page.locator('.gc').first();
    await cell.locator('.gc-pick').click();
    await cell.locator('.mock-input').fill('chi');
    await expect(page.locator('.autocomplete-dropdown')).toBeVisible();
  });

  test.fail('clicking a suggestion fills the cell and closes the editor', async ({ page }) => {
    const cell = page.locator('.gc').first();
    await cell.locator('.gc-pick').click();
    await cell.locator('.mock-input').fill('chi');
    await page.locator('.autocomplete-dropdown .suggestion-item').first().click();
    await expect(cell).toHaveClass(/custom-g/);
    await expect(cell.locator('.mock-input')).not.toBeVisible();
  });
```

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/tests/planning-wizard-step3.e2e.ts
git commit -m "test(e2e): add Step 3 persistence and autocomplete test.fail() tests"
```

---

### Task 6: Run verify and open PR

**Files:** No new files.

- [ ] **Step 1: Run full quality suite**

```bash
cd /Users/robert/Development/plnd
just verify
```

Expected: all checks pass (fmt, clippy, deny, machete, ts-lint, ts-deps, verify-build, test-ci).

- [ ] **Step 2: If e2e tests fail, diagnose**

Playwright e2e tests run against a live dev server. If `just verify` skips e2e tests (likely — CI mode may not run them), also run:

```bash
cd /Users/robert/Development/plnd/plnd_client
npx playwright test e2e/tests/planning-wizard-step3.e2e.ts --reporter=list
```

The `test.fail()` tests should show as "passed" (a `test.fail()` test passes when it fails as expected). If any non-`test.fail()` test fails, investigate the selector or component state.

- [ ] **Step 3: Open PR**

```bash
gh pr create \
  --title "test(e2e): Planning Wizard — Step 3 Meals Planning (#106)" \
  --body "$(cat <<'EOF'
## Summary
- Adds `plnd_client/e2e/tests/planning-wizard-step3.e2e.ts` with 14 e2e scenarios for the meals planning grid
- Seeds a 3-day horizon (Mon 2026-03-30 → Wed 2026-04-01) via localStorage to test Step 3 in isolation
- Two autocomplete scenarios marked `test.fail()` — will activate automatically when phase-3 autocomplete ships

## Test Coverage
- Grid structure: 3 day headers, 3 slot labels, 9 cells
- Day header content: correct day names and dates
- Pending cell: gc-pick opens editor, Enter confirms, Escape cancels
- Custom meal: title shown, gc-x clears back to pending
- Skip/undo: gc-x skips, gc-undo restores
- Persistence: meals survive Step 3 → Step 4 → Step 3 navigation
- Autocomplete (test.fail): dropdown visibility, suggestion selection

Closes #106

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
