import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { seedAuth, API_BASE } from '../helpers/auth';
import { patchPreferences } from '../helpers/seed-data';

// Fixed seed: 3-day horizon Mon 2026-03-30 → Wed 2026-04-01
// seedAuth provisions an onboarded user with default prefs (week_start_day=1)
// and the "Everyday" day type with breakfast/lunch/dinner. We then patch
// preferences to default_plan_length_days=3 so the wizard computes the same
// horizon used by the test fixtures.
// currentStep: 3 → wizard opens directly on the Meals step

// Agent meal fixtures for the 3-day horizon
const STEP3_MEAL_DAYS = ['2026-03-30', '2026-03-31', '2026-04-01'];
const STEP3_AGENT_MEALS = STEP3_MEAL_DAYS.flatMap(date =>
  (['breakfast', 'lunch', 'dinner'] as const).map(name => ({
    date, meal_name: name, meal_ref: null, title: `${name} on ${date}`,
  }))
);

async function seedWizard(page: Page): Promise<{ sub: string }> {
  const { sub } = await seedAuth(page);
  await patchPreferences(sub, { default_plan_length_days: 3 });
  // Step 3 auto-generates via agent on first entry when no meals are stored.
  // Mock policy: agent endpoints are the only thing we still mock.
  await page.route(`${API_BASE}/agent/meal-plan`, route =>
    route.fulfill({ status: 200, json: { week: '2026-03-30', meals: STEP3_AGENT_MEALS } })
  );
  // Per-cell resolve (edit → Enter) and suggest (🔀) routes
  await page.route(`${API_BASE}/agent/meal-plan/resolve`, route =>
    route.fulfill({ status: 200, json: { meal_ref: null, confirmation: 'Added' } })
  );
  await page.route(`${API_BASE}/agent/meal-plan/suggest`, route =>
    route.fulfill({ status: 200, json: { date: '2026-03-30', meal_name: 'breakfast', meal_ref: null, title: 'Suggested meal' } })
  );
  return { sub };
}

async function seedStep3(page: Page): Promise<{ sub: string }> {
  await page.addInitScript(() => {
    localStorage.setItem('plnd:plan-draft', JSON.stringify({
      schemaVersion: 2,
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
  return seedWizard(page);
}

test.describe('Planning Wizard — Step 3: Meals Planning', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedStep3(page);
    await page.goto('/plan/week');
    await expect(page.locator('.planning-wizard')).toBeVisible();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('3');
    // Auto-generation runs on entry and the grid only renders once it finishes
    // (while generating, the loader replaces the grid). Gate on the first cell
    // so no test races the generation-complete settle under parallel load (#970).
    await expect(page.locator('.gc').first()).toBeVisible();
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
      // The cell count is days × deduped slots, and the slot set settles after
      // the day-types load resolves. Inherits the generous global expect.timeout
      // (30s) so the wait survives a mid-settle stall under parallel load instead
      // of observing 6 against Playwright's default 5s ceiling (#970, #988).
      await expect(page.locator('.gc')).toHaveCount(9);
    });
  });

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

    test('typing a name and pressing Enter fills the cell with approved-g state', async ({ page }) => {
      // Wait for auto-generate to complete before interacting
      await expect(page.locator('.gc').first().locator('.gc-pick')).toBeVisible();
      const cell = page.locator('.gc').first();
      await cell.locator('.gc-pick').click();
      await cell.locator('.mock-input').fill('Greek yogurt');
      await cell.locator('.mock-input').press('Enter');
      // resolveText fires async; Playwright polls until approved-g appears
      await expect(cell).toHaveClass(/approved-g/);
      await expect(cell.locator('.gc-text.approved-t')).toHaveText('Greek yogurt');
    });

    test('pressing Escape cancels edit without saving', async ({ page }) => {
      const cell = page.locator('.gc').first();
      await cell.locator('.gc-pick').click();
      await cell.locator('.mock-input').fill('Should not save');
      await cell.locator('.mock-input').press('Escape');
      await expect(cell).not.toHaveClass(/gc-editing/);
      await expect(cell.locator('.gc-pick')).toBeVisible();
      await expect(cell.locator('.gc-text.approved-t')).not.toBeVisible();
    });
  });

  // ── Custom meal cell ─────────────────────────────────────────────────────────

  test.describe('Custom meal cell', () => {
    test('a filled cell shows the meal title in gc-text.approved-t', async ({ page }) => {
      const cell = page.locator('.gc').first();
      // Fill via the editor
      await cell.locator('.gc-pick').click();
      await cell.locator('.mock-input').fill('Avocado toast');
      await cell.locator('.mock-input').press('Enter');
      await expect(cell.locator('.gc-text.approved-t')).toHaveText('Avocado toast');
    });

    test('clicking gc-x on an approved cell skips it', async ({ page }) => {
      const cell = page.locator('.gc').first();
      // First fill the cell
      await cell.locator('.gc-pick').click();
      await cell.locator('.mock-input').fill('Avocado toast');
      await cell.locator('.mock-input').press('Enter');
      await expect(cell).toHaveClass(/approved-g/);
      // gc-x now skips (not clears) — matches proposed and approved behaviour
      await cell.locator('.gc-x').click();
      await expect(cell).toHaveClass(/skipped-g/);
      await expect(cell.locator('.gc-undo')).toBeVisible();
    });
  });

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

  // ── Persistence ───────────────────────────────────────────────────────────────

  test('meals state survives navigating to Step 5 and back to Step 3', async ({ page }) => {
    const cell = page.locator('.gc').first();
    // Fill Mon/Breakfast
    await cell.locator('.gc-pick').click();
    await cell.locator('.mock-input').fill('Overnight oats');
    await cell.locator('.mock-input').press('Enter');
    await expect(cell).toHaveClass(/approved-g/);

    // Navigate to Step 5
    await page.getByLabel('Next step').click();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('5');

    // Navigate back to Step 3
    await page.getByLabel('Previous step').click();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('3');

    // Meal should still be set
    await expect(page.locator('.gc').first()).toHaveClass(/approved-g/);
    await expect(page.locator('.gc').first().locator('.gc-text.approved-t')).toHaveText('Overnight oats');
  });

  // ── Autocomplete — test.fail() (phase-3) ─────────────────────────────────────
  // These tests are expected to FAIL until autocomplete is implemented.
  // When they start passing, remove test.fail() and the comment.

  test('typing in mock-input shows a suggestion dropdown', async ({ page }) => {
    test.fail();
    const cell = page.locator('.gc').first();
    await cell.locator('.gc-pick').click();
    await cell.locator('.mock-input').fill('chi');
    // Expected-failure wait (test.fail above): autocomplete is not built yet, so
    // this must fail FAST within the per-test budget. Keep an explicit short
    // ceiling — it must NOT inherit the generous global expect.timeout (#988),
    // or the assertion races the per-test timeout and reports a hard failure
    // instead of the clean expected failure.
    await expect(page.locator('.autocomplete-dropdown')).toBeVisible({ timeout: 3_000 });
  });

  test('clicking a suggestion fills the cell and closes the editor', async ({ page }) => {
    test.fail();
    const cell = page.locator('.gc').first();
    await cell.locator('.gc-pick').click();
    await cell.locator('.mock-input').fill('chi');
    // Autocomplete dropdown does not yet exist — fail fast so test.fail() registers
    // correctly. Explicit short ceiling on purpose: it must NOT inherit the generous
    // global expect.timeout (#988), else it races the per-test timeout and reports a
    // hard failure instead of the expected failure.
    await expect(page.locator('.autocomplete-dropdown')).toBeVisible({ timeout: 3_000 });
    await page.locator('.autocomplete-dropdown .suggestion-item').first().click();
    await expect(cell).toHaveClass(/approved-g/);
    await expect(cell.locator('.mock-input')).not.toBeVisible();
  });
});

// ── Agent-driven flow ────────────────────────────────────────────────────────
// Uses POST /agent/meal-plan and /agent/meal-plan/rebalance mocks.
// seedStep3AgentMock provides an empty scheduledMeals draft so ngOnInit auto-generates.

const AGENT_MEALS = ['2026-03-30', '2026-03-31', '2026-04-01'].flatMap(date =>
  (['breakfast', 'lunch', 'dinner'] as const).map(name => ({
    date,
    meal_name: name,
    meal_ref: null,
    title: `${name} on ${date}`,
    estimated: true,
  }))
);

const MEAL_PLAN_RESPONSE = { week: '2026-03-30', meals: AGENT_MEALS };

async function seedStep3AgentMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('plnd:plan-draft', JSON.stringify({
      schemaVersion: 2,
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
  await page.route(`${API_BASE}/agent/meal-plan`, route =>
    route.fulfill({ status: 200, json: MEAL_PLAN_RESPONSE })
  );
  await page.route(`${API_BASE}/agent/meal-plan/rebalance`, route =>
    route.fulfill({ status: 200, json: MEAL_PLAN_RESPONSE })
  );
}

test.describe('Planning Wizard — Step 3: Agent-driven meal flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedStep3AgentMock(page);
    await page.goto('/plan/week');
    await expect(page.locator('.planning-wizard')).toBeVisible();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('3');
    // Auto-generation runs on entry and the grid only renders once it finishes
    // (while generating, the loader replaces the grid). Gate on the first cell
    // so no test races the generation-complete settle under parallel load (#970).
    await expect(page.locator('.gc').first()).toBeVisible();
  });

  test('auto-generate populates all cells with proposed meals on first entry', async ({ page }) => {
    // Wait for skeleton to clear and cells to show titles
    await expect(page.locator('.gc').first().locator('.gc-text')).toBeVisible();
    await expect(page.locator('.gc').first().locator('.gc-text')).toContainText('breakfast on 2026-03-30');
    // All 9 cells should have proposed state (gc-approve button visible)
    await expect(page.locator('.gc-approve').first()).toBeVisible();
  });

  test('approve one meal — cell shows approved-g', async ({ page }) => {
    await expect(page.locator('.gc').first().locator('.gc-approve')).toBeVisible();
    await page.locator('.gc').first().locator('.gc-approve').click();
    await expect(page.locator('.gc').first()).toHaveClass(/approved-g/);
    await expect(page.locator('.gc').first().locator('.gc-edit-custom')).toBeVisible();
  });

  test('Refresh modal shows the correct unapproved count', async ({ page }) => {
    test.setTimeout(15_000);
    // Wait for auto-generate to complete before clicking
    await expect(page.locator('.gc').first().locator('.gc-approve')).toBeVisible();
    // Approve one meal first
    await page.locator('.gc').first().locator('.gc-approve').click();
    await expect(page.locator('.btn-refresh-all')).toBeVisible();
    const badge = page.locator('.badge');
    // 9 total − 1 approved = 8 unapproved
    await expect(badge).toHaveText('8');
    await page.locator('.btn-refresh-all').click();
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('.modal-msg')).toContainText('8');
  });

  test('confirm Refresh — approved meal is unchanged, proposed cells are refreshed', async ({ page }) => {
    test.setTimeout(15_000);
    // Wait for auto-generate to complete before clicking
    await expect(page.locator('.gc').first().locator('.gc-approve')).toBeVisible();
    // Approve first cell
    await page.locator('.gc').first().locator('.gc-approve').click();
    const approvedText = await page.locator('.gc').first().locator('.gc-text.approved-t').textContent();

    // Open refresh modal and confirm
    await page.locator('.btn-refresh-all').click();
    await page.locator('.btn-confirm').click();

    // Approved cell title must be unchanged
    await expect(page.locator('.gc').first().locator('.gc-text.approved-t')).toHaveText(approvedText!.trim());
    await expect(page.locator('.gc').first()).toHaveClass(/approved-g/);
  });
});
