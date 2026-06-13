import { test, expect } from '@playwright/test';
import { DayViewPage } from '../pages/day-view.page';
import { seedAuth } from '../helpers/auth';
import { seedScheduleEntries } from '../helpers/seed-data';

// Inline task editor — edits flow through the real backend (no schedule mocks).
// Seeds one fixed-time (non-floating) task, edits its title and toggles
// "skip if missed" on, then reloads to prove both changes persisted.

test.describe('Day View — inline task edit', () => {
  // Monday-anchored planning week containing the target date.
  const PLAN_START = '2026-06-08';
  const PLAN_END = '2026-06-14';
  const DATE = '2026-06-13';

  test('editing a task title and skip-if-missed persists across reload', async ({ page }) => {
    const { sub } = await seedAuth(page);
    await seedScheduleEntries(sub, {
      plan_start: PLAN_START,
      plan_end: PLAN_END,
      placed_tasks: [
        {
          date: DATE,
          task_type: 'appointment',
          title: 'Call dentist',
          scheduled_start: '11:00:00',
          duration_minutes: 30,
          energy_required: 'low',
        },
      ],
    });

    const dayView = new DayViewPage(page);
    await dayView.gotoDate(DATE);
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

    // Open the inline editor by clicking the task label (role=button span).
    await page.getByText('Call dentist').click();

    // Change the title and blur to commit (the form commits title on blur).
    // Wait for the resulting PATCH so the reload can't beat the persisted write.
    const title = page.locator('input[name="title"]');
    const titlePatch = page.waitForResponse(
      r => /\/schedule\/entries\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH',
    );
    await title.fill('Call orthodontist');
    await title.blur();
    await titlePatch;

    // Turn on "skip if missed" (one-shot), awaiting its PATCH too.
    const oneShotPatch = page.waitForResponse(
      r => /\/schedule\/entries\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH',
    );
    await page.getByRole('switch', { name: /skip if missed/i }).click();
    await oneShotPatch;

    // Reload to force a fresh GET /schedule/period from the real backend.
    await page.reload();
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

    await expect(page.getByText('Call orthodontist')).toBeVisible();
    await expect(page.locator('.one-shot-indicator')).toBeVisible();
  });
});
