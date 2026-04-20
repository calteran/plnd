import { test, expect } from '@playwright/test';
import { DayViewPage } from '../pages/day-view.page';
import { API_BASE, seedAuth } from '../helpers/auth';

const TEST_DATE = '2026-03-29';

test.describe('Day View — Meal Review Pane', () => {

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedAuth(page);
  });

  test('Review button opens the review pane', async ({ page }) => {
    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TEST_DATE);
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

    const mealRow = dayView.getMealRows().first();
    await expect(mealRow.locator('.review-btn')).toBeVisible();

    await mealRow.locator('.review-btn').click();
    await expect(mealRow.locator('app-meal-review-pane')).toBeVisible();
  });

  test('done checkbox does not open the review pane', async ({ page }) => {
    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TEST_DATE);
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

    const mealRow = dayView.getMealRows().first();
    await mealRow.locator('.done-checkbox').click();

    // Pane should NOT open
    await expect(mealRow.locator('app-meal-review-pane')).not.toBeVisible();
  });

  test('swap via text input: submits resolve, row updates, pane closes', async ({ page }) => {
    // Mock the resolve API
    await page.route(`${API_BASE}/agent/meal-plan/resolve`, route =>
      route.fulfill({
        status: 200,
        json: { meal_ref: null, confirmation: 'Scheduled Greek yogurt bowl' },
      })
    );

    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TEST_DATE);
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

    const mealRow = dayView.getMealRows().first();

    // Open review pane
    await mealRow.locator('.review-btn').click();
    await expect(mealRow.locator('app-meal-review-pane')).toBeVisible();

    // Click Swap (meal from mock has status 'planned' → filled → shows swap)
    await mealRow.locator('[data-action="swap"]').click();

    // Fill and submit
    await mealRow.locator('.resolve-input').fill('Greek yogurt bowl');
    await mealRow.locator('.resolve-submit').click();

    // Pane should close after successful resolve
    await expect(mealRow.locator('app-meal-review-pane')).not.toBeVisible({ timeout: 5_000 });
  });
});
