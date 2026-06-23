// e2e: a floating task can be dragged into the empty 'start of day' slot,
// i.e. above the first real anchor of the day.
//
// (Naming note: this file is *.e2e.ts on purpose — Playwright's testMatch only
// collects *.e2e.ts, so the older e2e/tests/*.spec.ts files never run; see #999.)
//
// The 'start of day' slot renders as a bare .slot-drop-list div with no label.
// When it holds no tasks it would collapse to zero height, so CDK's drop-target
// geometry (_canReceive → isInsideClientRect / elementFromPoint) can never match
// it: a task can't be dropped above the first anchor. The fix is a *permanent*
// min-height on .slot-drop-list — CDK caches a list's hit-rect at drag start,
// before a drag-only class would apply, so the height must exist up front.
//
// We seed a real first anchor (Breakfast) with one floating task in *its* slot —
// so the start-of-day slot above it starts out empty — then drag the task up into
// that empty zone and assert it lands ABOVE Breakfast after a reload (proving the
// drop registered and the PATCH /position round-trip persisted).
//
// No page.route() mocks on /schedule/* — all data flows through the real API.
// Per-test user isolation via seedAuth (unique sub per test).

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { DayViewPage } from '../pages/day-view.page';
import { seedAuth } from '../helpers/auth';
import { seedMealAnchor, seedScheduleEntries } from '../helpers/seed-data';

const TEST_DATE  = '2026-05-06'; // Tuesday, within a clearly-bounded test window
const PLAN_START = '2026-05-05'; // Monday
const PLAN_END   = '2026-05-11'; // Sunday

const MORNING_TASK = 'Morning Task';

test.describe('Day View — drag a task above the first anchor', () => {

  test('a task drops into the empty start-of-day slot above the first anchor', async ({ page }) => {
    const { sub } = await seedAuth(page);

    // A real first anchor (Breakfast) with one floating task in *its* slot, so the
    // start-of-day slot above it starts out empty (zero-height = the bug's target).
    await seedMealAnchor(sub, { date: TEST_DATE, name: 'breakfast', preferred_time: '08:00' });
    await seedScheduleEntries(sub, {
      plan_start: PLAN_START,
      plan_end:   PLAN_END,
      placed_tasks: [
        {
          date:         TEST_DATE,
          task_type:    'general',
          title:        MORNING_TASK,
          after_anchor: 'breakfast',
        },
      ],
    });

    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TEST_DATE);
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 10_000 });

    const taskRow = page.locator('[data-testid="task-row"]', { hasText: MORNING_TASK });
    await expect(page.locator('app-meal-row')).toBeVisible({ timeout: 5_000 });
    await expect(taskRow).toBeVisible({ timeout: 5_000 });

    // Sanity: the task starts AFTER Breakfast (in the breakfast slot, not above it).
    const orderBefore = await rowOrder(page);
    expect(orderBefore.indexOf(MORNING_TASK)).toBeGreaterThan(orderBefore.indexOf('Breakfast'));

    // ── Drag the task up into the start-of-day zone (above the Breakfast row) ──
    //
    // CDK needs a genuine pointer move past its drag threshold (≥ 5px from
    // mousedown), so we drive the pointer lifecycle by hand rather than dragTo().
    const taskBB = await taskRow.boundingBox();
    const listBB = await dayView.getScheduleList().boundingBox();
    if (!taskBB || !listBB) throw new Error('Could not get bounding boxes for drag');

    const startX = taskBB.x + taskBB.width / 2;
    const startY = taskBB.y + taskBB.height / 2;
    // Target the very top of the schedule list — start-of-day is the first slot in
    // it (the seeded user has no timezone anchors, so no travel-day switch row sits
    // above it), and its permanent min-height makes +8px land inside that zone.
    const endX = listBB.x + listBB.width / 2;
    const endY = listBB.y + 8;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 3,  { steps: 3 });   // cross CDK threshold
    await page.mouse.move(startX, startY - 12, { steps: 5 });   // continue moving
    await page.mouse.move(endX,   endY,         { steps: 25 });  // sweep to the top
    await page.waitForTimeout(50); // settle proximity calc
    // Wait for the actual PATCH /position round-trip (set up before mouse.up so we
    // can't miss it) rather than a hardcoded timeout — the backend has provably
    // processed the move before we reload.
    const repositioned = page.waitForResponse(
      r => r.url().includes('/position') && r.request().method() === 'PATCH',
    );
    await page.mouse.up();
    await repositioned;

    // Reload so order comes from the real backend, then assert the task now sits
    // ABOVE Breakfast — i.e., it landed in the start-of-day slot and persisted.
    await page.reload();
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="task-row"]', { hasText: MORNING_TASK }))
      .toBeVisible({ timeout: 5_000 });

    const orderAfter = await rowOrder(page);
    expect(orderAfter.indexOf(MORNING_TASK)).toBeLessThan(orderAfter.indexOf('Breakfast'));
  });

});

/** Newline-joined innerText of every meal/task row in rendered DOM order. */
async function rowOrder(page: Page): Promise<string> {
  const rows = page.locator('.schedule-list app-meal-row, .schedule-list app-task-row');
  await expect(rows.first()).toBeVisible({ timeout: 5_000 });
  return (await rows.allInnerTexts()).join('\n');
}
