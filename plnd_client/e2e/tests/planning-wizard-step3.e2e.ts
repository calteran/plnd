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
});
