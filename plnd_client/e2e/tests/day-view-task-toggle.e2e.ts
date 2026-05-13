import { test, expect } from '@playwright/test';
import { DayViewPage } from '../pages/day-view.page';
import { seedAuth } from '../helpers/auth';
import { seedScheduleEntries } from '../helpers/seed-data';

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Day View — Task Completion Toggle', () => {

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
    // Use a non-today date so mock data returns all tasks as pending.
    const PENDING_DATE = '2026-03-29';

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
    // Today's date (2026-03-28) — mock data returns top-level tasks as done.
    const TODAY_DATE = '2026-03-28';

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
  //
  // The toggle currently mutates only client-side signal state — see
  // ScheduleService.toggleItem() (no HTTP). True end-to-end coverage will
  // arrive when toggleItem PATCHes /schedule/entries/{id}/status; tracked in
  // a follow-up issue. Until then the DOM-behavior tests above are the
  // critical-journey exemplar (zero page.route() per test against real
  // seeded entries; see docs/architecture.md §9).

});
