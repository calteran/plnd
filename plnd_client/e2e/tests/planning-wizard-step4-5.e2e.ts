import { test, expect, Page } from '@playwright/test';
import { seedAuth, API_BASE } from '../helpers/auth';

// Fixed seed: 7-day horizon Mon 2026-03-30 → Sun 2026-04-05
// seedAuth defaults: week_start_day=1, default_plan_length_days=7, plus the
// "Everyday" day type with breakfast/lunch/dinner meal patterns.
// currentStep: 5 or 6 → wizard opens directly on Day Review or Confirmation

const MOCK_TASKS = [
  { title: 'Morning run', energy: 'high', date: '2026-03-30', task_type: 'general' },
  { title: 'Read book',   energy: 'low',  date: '2026-03-30', task_type: 'general' },
];

async function seedWizard(page: Page): Promise<{ sub: string }> {
  const { sub } = await seedAuth(page);
  // Step 3 auto-generates via agent on first entry when no meals are stored.
  // Mock policy: agent endpoints are the only thing we still mock. Return an
  // empty meals list so the skeleton resolves immediately without stalling
  // navigation through the wizard.
  await page.route(`${API_BASE}/agent/meal-plan`, route =>
    route.fulfill({ status: 200, json: { week: '2026-03-30', meals: [] } })
  );
  return { sub };
}

async function seedStep5DayReview(page: Page): Promise<{ sub: string }> {
  await page.addInitScript((tasks) => {
    localStorage.setItem('plnd:plan-draft', JSON.stringify({
      schemaVersion: 2,
      planStart: '2026-03-30',
      planEnd: '2026-04-05',
      currentStep: 5,
      carryoverDecisions: {},
      scheduledMeals: {},
      scheduledTasks: tasks,
      floatingTasks: [],
      savedAt: '2026-03-29T00:00:00.000Z',
    }));
  }, MOCK_TASKS);
  return seedWizard(page);
}

async function seedStep6Confirm(page: Page): Promise<{ sub: string }> {
  await page.addInitScript((tasks) => {
    localStorage.setItem('plnd:plan-draft', JSON.stringify({
      schemaVersion: 2,
      planStart: '2026-03-30',
      planEnd: '2026-04-05',
      currentStep: 6,
      carryoverDecisions: {},
      scheduledMeals: {},
      scheduledTasks: tasks,
      floatingTasks: [],
      savedAt: '2026-03-29T00:00:00.000Z',
    }));
  }, MOCK_TASKS);
  return seedWizard(page);
}

// ── Step 5 — Day Review ───────────────────────────────────────────────────────

test.describe('Planning Wizard — Step 5: Day Review', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedStep5DayReview(page);
    await page.goto('/plan/week');
    await expect(page.locator('.planning-wizard')).toBeVisible();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('5');
  });

  // ── Card grid ───────────────────────────────────────────────────────────────

  test('card grid renders one card per day in the horizon', async ({ page }) => {
    await expect(page.locator('.day-card')).toHaveCount(7);
  });

  // ── Collapsed by default ───────────────────────────────────────────────────

  test('cards are collapsed by default', async ({ page }) => {
    const card = page.locator('.day-card').first();
    await expect(card).not.toHaveClass(/expanded/);
    await expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  // ── Card header content ────────────────────────────────────────────────────

  test('first card shows correct day name and date', async ({ page }) => {
    const card = page.locator('.day-card').first();
    // date pipe 'EEE' produces "Mon"; CSS text-transform is not visible to Playwright
    await expect(card.locator('.day-name')).toHaveText('Mon');
    await expect(card.locator('.day-date')).toContainText('Mar 30');
  });

  // ── Expand / collapse ──────────────────────────────────────────────────────

  test('clicking a card expands it and reveals day details', async ({ page }) => {
    const card = page.locator('.day-card').first();
    await card.click();
    await expect(card).toHaveClass(/expanded/);
    await expect(card).toHaveAttribute('aria-expanded', 'true');
    // Both "Meals" and "Tasks" section labels become visible
    const labels = card.locator('.body-section-label');
    await expect(labels).toHaveCount(2);
    await expect(labels.nth(0)).toHaveText('Meals');
    await expect(labels.nth(1)).toHaveText('Tasks');
  });

  test('clicking an expanded card collapses it', async ({ page }) => {
    const card = page.locator('.day-card').first();
    // Expand
    await card.click();
    await expect(card).toHaveClass(/expanded/);
    // Collapse
    await card.click();
    await expect(card).not.toHaveClass(/expanded/);
    await expect(card).toHaveAttribute('aria-expanded', 'false');
  });
});

// ── Step 6 — Confirmation ─────────────────────────────────────────────────────

test.describe('Planning Wizard — Step 6: Confirmation', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedStep6Confirm(page);
    await page.goto('/plan/week');
    await expect(page.locator('.planning-wizard')).toBeVisible();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('6');
  });

  // ── Completion banner ──────────────────────────────────────────────────────

  test('"Ready to go!" completion banner is displayed', async ({ page }) => {
    await expect(page.locator('.completion-banner')).toBeVisible();
    await expect(page.locator('.banner-heading')).toHaveText('Ready to go!');
  });

  // ── Stats ──────────────────────────────────────────────────────────────────

  test('stats show total days: 7', async ({ page }) => {
    const stat = page.locator('.banner-stat').nth(0);
    await expect(stat.locator('.b-val')).toHaveText('7');
    await expect(stat.locator('.b-lbl')).toHaveText('Days');
  });

  test('stats show meal coverage: 100% (all slots covered by mock suggestions)', async ({ page }) => {
    const stat = page.locator('.banner-stat').nth(1);
    await expect(stat.locator('.b-val')).toHaveText('100%');
    await expect(stat.locator('.b-lbl')).toHaveText('Meals');
  });

  test('stats show task count: 2', async ({ page }) => {
    const stat = page.locator('.banner-stat').nth(2);
    await expect(stat.locator('.b-val')).toHaveText('2');
    await expect(stat.locator('.b-lbl')).toHaveText('Tasks');
  });

  // ── Finish button ──────────────────────────────────────────────────────────

  test('"Finish Week Plan" button is present and enabled', async ({ page }) => {
    const btn = page.locator('.btn-finish');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  // ── Finish — success ───────────────────────────────────────────────────────

  test.describe('Finish — success', () => {
    test('clicking Finish triggers POST /schedule/plan and redirects to /day/:date', async ({ page }) => {
      // Real backend serves POST /schedule/plan; the seeded onboarded user has
      // a planning task created on demand by /tasks/weekly-plan, so commit
      // succeeds without any mocks.
      const submitRequest = page.waitForRequest(req =>
        req.url().includes('/schedule/plan') && req.method() === 'POST'
      );

      await page.locator('.btn-finish').click();
      await submitRequest;

      await expect(page).toHaveURL(/\/day\//);
    });
  });

  // ── Finish — error ─────────────────────────────────────────────────────────
  // Edge-case error path: the real backend cannot be coerced into a 500 on
  // demand, so we keep an explicit 500-response mock for POST /schedule/plan
  // here. This is a deliberate exception to the de-mock policy — the test's
  // purpose is to verify the UI's error-handling, not the backend's success
  // path.

  test.describe('Finish — error', () => {
    test.beforeEach(async ({ page }) => {
      await page.route(`${API_BASE}/schedule/plan`, route =>
        route.fulfill({ status: 500, json: { error: 'Internal server error' } })
      );
    });

    test('submission failure shows error banner with failure message', async ({ page }) => {
      await page.locator('.btn-finish').click();
      await expect(page.locator('.error-banner')).toBeVisible();
      await expect(page.locator('.error-banner')).toContainText('Failed to save plan');
    });

    test('error banner has role="alert" for accessibility', async ({ page }) => {
      await page.locator('.btn-finish').click();
      await expect(page.locator('[role="alert"]')).toBeVisible();
    });

    test('Finish button is re-enabled after submission failure', async ({ page }) => {
      await page.locator('.btn-finish').click();
      await expect(page.locator('.error-banner')).toBeVisible();
      await expect(page.locator('.btn-finish')).toBeEnabled();
    });
  });
});
