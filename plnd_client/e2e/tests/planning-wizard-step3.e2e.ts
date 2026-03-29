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
});
