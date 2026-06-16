import { test, expect } from '../fixtures';
import { DayViewPage } from '../pages/day-view.page';
import { seedAuth } from '../helpers/auth';
import { seedScheduleEntries } from '../helpers/seed-data';

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Day View — Task Completion Toggle', () => {

  const PENDING_DATE = '2026-03-29';
  const TODAY_DATE   = '2026-03-28';

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    const { sub } = await seedAuth(page);
    await seedScheduleEntries(sub, {
      plan_start: '2026-03-23',
      plan_end: '2026-03-29',
      placed_tasks: [
        { date: '2026-03-28', task_type: 'general', title: 'Morning stretch', scheduled_start: '07:00:00', status: 'completed' },
        { date: '2026-03-29', task_type: 'general', title: 'Morning stretch', scheduled_start: '07:00:00', status: 'planned' },
      ],
    });
  });

  // ── Incomplete → complete ────────────────────────────────────────────────

  test.describe('marking an incomplete task as complete', () => {

    test('clicking the checkbox sets aria-checked to true', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(PENDING_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      const checkbox = dayView.getTaskRowCheckbox(row);

      await expect(checkbox).toHaveAttribute('aria-checked', 'false');
      await checkbox.click();
      await expect(checkbox).toHaveAttribute('aria-checked', 'true');
    });

    test('the task row gains the done class after toggling', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(PENDING_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      await expect(dayView.getTaskRowInner(row)).not.toHaveClass(/done/);
      await dayView.getTaskRowCheckbox(row).click();
      await expect(dayView.getTaskRowInner(row)).toHaveClass(/done/);
    });

    test('the task label gains the struck class after toggling', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(PENDING_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      await expect(dayView.getTaskRowLabel(row)).not.toHaveClass(/struck/);
      await dayView.getTaskRowCheckbox(row).click();
      await expect(dayView.getTaskRowLabel(row)).toHaveClass(/struck/);
    });
  });

  // ── Complete → incomplete ────────────────────────────────────────────────

  test.describe('marking a complete task as incomplete', () => {

    test('clicking the checkbox sets aria-checked to false', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(TODAY_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      const checkbox = dayView.getTaskRowCheckbox(row);

      await expect(checkbox).toHaveAttribute('aria-checked', 'true');
      await checkbox.click();
      await expect(checkbox).toHaveAttribute('aria-checked', 'false');
    });

    test('the task row loses the done class after toggling', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(TODAY_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      await expect(dayView.getTaskRowInner(row)).toHaveClass(/done/);
      await dayView.getTaskRowCheckbox(row).click();
      await expect(dayView.getTaskRowInner(row)).not.toHaveClass(/done/);
    });

    test('the task label loses the struck class after toggling', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(TODAY_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      await expect(dayView.getTaskRowLabel(row)).toHaveClass(/struck/);
      await dayView.getTaskRowCheckbox(row).click();
      await expect(dayView.getTaskRowLabel(row)).not.toHaveClass(/struck/);
    });
  });

  // ── API integration ──────────────────────────────────────────────────────

  test.describe('API integration — toggle persists across reload', () => {

    test('toggling a task persists after navigating away and back', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(PENDING_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      await expect(dayView.getTaskRowCheckbox(dayView.getTaskRows().first()))
        .toHaveAttribute('aria-checked', 'false');

      // Toggle and wait for the PATCH to settle before navigating away
      const [patchResponse] = await Promise.all([
        page.waitForResponse(
          r => r.url().includes('/schedule/entries/') && r.request().method() === 'PATCH',
          { timeout: 5_000 },
        ),
        dayView.getTaskRowCheckbox(dayView.getTaskRows().first()).click(),
      ]);
      expect(patchResponse.status()).toBe(204);

      // Navigate to a different date and back — forces a fresh GET /schedule/period
      await dayView.gotoDate(TODAY_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.gotoDate(PENDING_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      // Backend-persisted status must still be reflected
      await expect(dayView.getTaskRowCheckbox(dayView.getTaskRows().first()))
        .toHaveAttribute('aria-checked', 'true');
      await expect(dayView.getTaskRowInner(dayView.getTaskRows().first()))
        .toHaveClass(/done/);
    });
  });

});
