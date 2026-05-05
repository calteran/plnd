import { test, expect, Page } from '@playwright/test';
import { seedAuth, API_BASE, MOCK_PREFS } from '../helpers/auth';

// Fixed seed: 3-day horizon Mon 2026-03-30 → Wed 2026-04-01
// Override default_plan_length_days → 3 so the wizard computes the same horizon
// currentStep: 3 → wizard opens directly on the Meals step

const MOCK_PREFS_3DAY = { ...MOCK_PREFS, default_plan_length_days: 3 };

// Agent meal fixtures for the 3-day horizon
const STEP3_MEAL_DAYS = ['2026-03-30', '2026-03-31', '2026-04-01'];
const STEP3_AGENT_MEALS = STEP3_MEAL_DAYS.flatMap(date =>
  (['breakfast', 'lunch', 'dinner'] as const).map(occasion => ({
    date, occasion, meal_ref: null, title: `${occasion} on ${date}`,
  }))
);

const MOCK_MEAL_PATTERN = [
  { id: 'mp1', user_id: 'test', name: 'breakfast', preferred_time: '08:00:00', tolerance_minutes: 60, sort_order: 1, created_at: '2026-01-01T00:00:00Z' },
  { id: 'mp2', user_id: 'test', name: 'lunch',     preferred_time: '12:00:00', tolerance_minutes: 60, sort_order: 2, created_at: '2026-01-01T00:00:00Z' },
  { id: 'mp3', user_id: 'test', name: 'dinner',    preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 3, created_at: '2026-01-01T00:00:00Z' },
];

async function seedWizard(page: Page): Promise<void> {
  await seedAuth(page);
  await page.route(`${API_BASE}/meal-pattern`, route =>
    route.fulfill({ status: 200, json: MOCK_MEAL_PATTERN })
  );
  await page.route(`${API_BASE}/preferences/me`, route =>
    route.fulfill({ status: 200, json: MOCK_PREFS_3DAY })
  );
  await page.route(`${API_BASE}/tasks/weekly-plan**`, route =>
    route.fulfill({ status: 200, json: { task_id: 'test-planning-task' } })
  );
  await page.route(`${API_BASE}/schedule/plan/carryover**`, route =>
    route.fulfill({ json: { carryover: [] } })
  );
  // Step 3 auto-generates via agent on first entry when no meals are stored.
  await page.route(`${API_BASE}/agent/meal-plan`, route =>
    route.fulfill({ status: 200, json: { week: '2026-03-30', meals: STEP3_AGENT_MEALS } })
  );
  // Per-cell resolve (edit → Enter) and suggest (🔀) routes
  await page.route(`${API_BASE}/agent/meal-plan/resolve`, route =>
    route.fulfill({ status: 200, json: { meal_ref: null, confirmation: 'Added' } })
  );
  await page.route(`${API_BASE}/agent/meal-plan/suggest`, route =>
    route.fulfill({ status: 200, json: { date: '2026-03-30', occasion: 'breakfast', meal_ref: null, title: 'Suggested meal' } })
  );
}

async function seedStep3(page: Page): Promise<void> {
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
}

test.describe('Planning Wizard — Step 3: Meals Planning', () => {
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

  test('meals state survives navigating to Step 4 and back to Step 3', async ({ page }) => {
    const cell = page.locator('.gc').first();
    // Fill Mon/Breakfast
    await cell.locator('.gc-pick').click();
    await cell.locator('.mock-input').fill('Overnight oats');
    await cell.locator('.mock-input').press('Enter');
    await expect(cell).toHaveClass(/approved-g/);

    // Navigate to Step 4
    await page.getByLabel('Next step').click();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('4');

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
    await expect(page.locator('.autocomplete-dropdown')).toBeVisible();
  });

  test('clicking a suggestion fills the cell and closes the editor', async ({ page }) => {
    test.fail();
    const cell = page.locator('.gc').first();
    await cell.locator('.gc-pick').click();
    await cell.locator('.mock-input').fill('chi');
    // Autocomplete dropdown does not yet exist — fail fast so test.fail() registers correctly
    await expect(page.locator('.autocomplete-dropdown')).toBeVisible({ timeout: 3000 });
    await page.locator('.autocomplete-dropdown .suggestion-item').first().click();
    await expect(cell).toHaveClass(/approved-g/);
    await expect(cell.locator('.mock-input')).not.toBeVisible();
  });
});

// ── Agent-driven flow ────────────────────────────────────────────────────────
// Uses POST /agent/meal-plan and /agent/meal-plan/rebalance mocks.
// seedStep3AgentMock provides an empty scheduledMeals draft so ngOnInit auto-generates.

const AGENT_MEALS = ['2026-03-30', '2026-03-31', '2026-04-01'].flatMap(date =>
  (['breakfast', 'lunch', 'dinner'] as const).map(occasion => ({
    date,
    occasion,
    meal_ref: null,
    title: `${occasion} on ${date}`,
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
