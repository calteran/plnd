import { test, expect } from '@playwright/test';
import { DayViewPage } from '../pages/day-view.page';
import { API_BASE, seedAuth } from '../helpers/auth';
import { seedMealAnchor } from '../helpers/seed-data';

const TEST_DATE = '2026-03-29';

test.describe('Day View — Meal Review Pane', () => {

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    const { sub } = await seedAuth(page);
    await seedMealAnchor(sub, { date: TEST_DATE, name: 'breakfast', preferred_time: '08:00' });
  });

  test('Review button opens the review pane', async ({ page }) => {
    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TEST_DATE);
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

    const mealRow = dayView.getMealRows().first();
    await expect(dayView.getMealRowReviewBtn(mealRow)).toBeVisible();

    await dayView.getMealRowReviewBtn(mealRow).click();
    await expect(dayView.getMealReviewPane(mealRow)).toBeVisible();
  });

  test('done checkbox does not open the review pane', async ({ page }) => {
    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TEST_DATE);
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

    const mealRow = dayView.getMealRows().first();
    await dayView.getMealRowDoneCheckbox(mealRow).click();

    await expect(dayView.getMealReviewPane(mealRow)).not.toBeVisible();
  });

  test('add via text input: submits resolve, row updates, pane closes', async ({ page }) => {
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

    await dayView.getMealRowReviewBtn(mealRow).click();
    await expect(dayView.getMealReviewPane(mealRow)).toBeVisible();

    // Unplanned anchors show "Add meal" (not "Swap"); both open the same resolve input.
    await mealRow.locator('[data-action="add"]').click();
    await mealRow.locator('.resolve-input').fill('Greek yogurt bowl');
    await mealRow.locator('.resolve-submit').click();

    await expect(dayView.getMealReviewPane(mealRow)).not.toBeVisible({ timeout: 5_000 });
  });
});
