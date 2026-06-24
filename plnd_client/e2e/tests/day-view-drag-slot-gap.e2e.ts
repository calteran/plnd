// e2e: the empty floating-task slot adds no gap at rest, and opens up to a
// reachable drop height only while a drag is in progress (#1001, follow-up to
// #1000).
//
// (Naming note: this file is *.e2e.ts on purpose — Playwright's testMatch only
// collects *.e2e.ts; see #999.)
//
// Background: an empty .slot-drop-list collapses to zero height, which CDK's
// drop-target geometry can never match (the #1000 bug). #1000 fixed it with a
// *permanent* min-height, but that left a resting gap under every empty slot.
// #1001 gates the height on a `dragging` class added synchronously on drag
// start, so the resting layout stays flush. This test guards both halves:
//   - at rest the empty start-of-day slot is collapsed (≈ 0px),
//   - mid-drag it reserves drop height (≥ ~24px).
//
// We measure via getBoundingClientRect().height in the page rather than
// Playwright's boundingBox(): a 0-height element is "not visible" to Playwright,
// so boundingBox() returns null — but its rect height is a clean 0.
//
// No page.route() mocks on /schedule/* — all data flows through the real API.
// Per-test user isolation via seedAuth (unique sub per test).

import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import { DayViewPage } from '../pages/day-view.page';
import { seedAuth } from '../helpers/auth';
import { seedMealAnchor, seedScheduleEntries } from '../helpers/seed-data';

const TEST_DATE  = '2026-05-06'; // Tuesday, within a clearly-bounded test window
const PLAN_START = '2026-05-05'; // Monday
const PLAN_END   = '2026-05-11'; // Sunday

const MORNING_TASK = 'Morning Task';

/** Rendered height of a locator's element, robust to zero-height (invisible) nodes. */
function heightOf(loc: Locator): Promise<number> {
  return loc.evaluate(el => el.getBoundingClientRect().height);
}

test.describe('Day View — floating-task slot gap only during drag', () => {

  test('empty start-of-day slot is flush at rest, opens mid-drag', async ({ page }) => {
    const { sub } = await seedAuth(page);

    // A real first anchor (Breakfast) with one floating task in *its* slot, so the
    // start-of-day slot above it starts out empty — the measurement target.
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

    // The empty start-of-day slot is the first .slot-drop-list in the list (the
    // seeded user has no timezone anchors, so no travel-day switch row precedes it).
    const startSlot = page.locator('.schedule-list .slot-drop-list').first();

    // ── At rest: the empty slot collapses, adding no visible gap. ──
    expect(await heightOf(startSlot)).toBeLessThan(12);

    // ── Begin a drag and HOLD it; the slot must open to a droppable height. ──
    //
    // CDK needs a genuine pointer move past its drag threshold (≥ 5px from
    // mousedown), so we drive the pointer lifecycle by hand rather than dragTo().
    // The dragged task lives in the *breakfast* slot, so the start-of-day slot
    // stays empty mid-drag — its height comes purely from the `dragging` class.
    const taskBB = await taskRow.boundingBox();
    if (!taskBB) throw new Error('Could not get bounding box for the dragged task');

    const startX = taskBB.x + taskBB.width / 2;
    const startY = taskBB.y + taskBB.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 3,  { steps: 3 });  // cross CDK threshold
    await page.mouse.move(startX, startY - 12, { steps: 5 });  // continue moving

    // Mid-drag: the gating class is on, so the empty slot reserves drop height
    // (1.5rem = 24px). Poll to absorb the change-detection settle after the move.
    await expect
      .poll(() => heightOf(startSlot), { timeout: 2_000 })
      .toBeGreaterThanOrEqual(20);

    // Release without asserting placement — slot *geometry*, not the drop, is the
    // subject here (the drop round-trip is covered by day-view-drag-start-of-day).
    await page.mouse.up();

    // ── Back at rest after the drag: the slot collapses again. ──
    await expect
      .poll(() => heightOf(startSlot), { timeout: 2_000 })
      .toBeLessThan(12);
  });

});
