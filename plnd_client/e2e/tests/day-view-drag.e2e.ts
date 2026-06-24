// e2e: drag-reorder a floating task slot on the day view persists via the backend.
//
// Seeds a single day with TWO floating tasks in the same slot ('start of day'),
// drags the second task above the first using a real mouse-pointer sequence
// (CDK DragDrop requires a genuine pointer event that clears its drag threshold),
// reloads the page, and asserts the new order is reflected from the backend —
// proving the PATCH /schedule/entries/{id}/position round-trip persisted.
//
// No page.route() mocks on /schedule/* — all data flows through the real API.
// Per-test user isolation via seedAuth (unique sub per test).

import { test, expect } from '../fixtures';
import { DayViewPage } from '../pages/day-view.page';
import { seedAuth } from '../helpers/auth';
import { seedScheduleEntries } from '../helpers/seed-data';

const TEST_DATE  = '2026-05-06'; // Tuesday, within a clearly-bounded test window
const PLAN_START = '2026-05-05'; // Monday
const PLAN_END   = '2026-05-11'; // Sunday

const TASK_1 = 'Alpha Task';
const TASK_2 = 'Beta Task';

test.describe('Day View — drag-reorder task slot', () => {

  test('reordering a slot survives reload (persisted via PATCH /position)', async ({ page }) => {
    const { sub } = await seedAuth(page);

    // Seed two floating tasks in the 'start of day' slot in known order:
    //   slot_position 0 → TASK_1 ("Alpha Task")
    //   slot_position 1 → TASK_2 ("Beta Task")
    // (Tasks are committed in order, so the API assigns slot_position 0, 1.)
    await seedScheduleEntries(sub, {
      plan_start: PLAN_START,
      plan_end:   PLAN_END,
      placed_tasks: [
        {
          date:         TEST_DATE,
          task_type:    'general',
          title:        TASK_1,
          after_anchor: 'start of day',
        },
        {
          date:         TEST_DATE,
          task_type:    'general',
          title:        TASK_2,
          after_anchor: 'start of day',
        },
      ],
    });

    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TEST_DATE);

    // Wait for the schedule list to be visible and both tasks to appear.
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 10_000 });

    // Locate tasks within the slot-drop-list using data-testid="task-row"
    // (added to task-row.ts template in this PR). The slot wraps floating tasks
    // in a .slot-drop-list div, so we scope to those rows within that container.
    const slotList = page.locator('.slot-drop-list').first();
    await expect(slotList).toBeVisible({ timeout: 5_000 });

    // Wait for both task titles to appear before trying to drag.
    await expect(slotList.getByText(TASK_1)).toBeVisible({ timeout: 5_000 });
    await expect(slotList.getByText(TASK_2)).toBeVisible({ timeout: 5_000 });

    const taskRows = slotList.locator('[data-testid="task-row"]');
    await expect(taskRows).toHaveCount(2, { timeout: 5_000 });

    // Verify initial order: TASK_1 first, TASK_2 second.
    await expect(taskRows.first()).toContainText(TASK_1);
    await expect(taskRows.nth(1)).toContainText(TASK_2);

    // ── CDK drag using explicit mouse sequence ───────────────────────────────
    //
    // Playwright's locator.dragTo() does NOT cross CDK's drag-start threshold
    // reliably because CDK needs a genuine pointer move of ≥ 5 px from mousedown.
    // We replicate the pointer lifecycle manually:
    //   1. hover → moves pointer over source element (triggers pointermove / hover)
    //   2. mouse.down → begins the pointer capture (CDK registers the drag source)
    //   3. Several mouse.move steps past the threshold, approaching the target
    //   4. mouse.up → finalises the drop at the current pointer position
    //
    const source = taskRows.nth(1); // TASK_2 — drag this one up
    const target = taskRows.first(); // TASK_1 — drop above this one

    const sourceBB = await source.boundingBox();
    const targetBB = await target.boundingBox();
    if (!sourceBB || !targetBB) throw new Error('Could not get bounding boxes for drag');

    // Start at the centre of TASK_2 and end above the centre of TASK_1.
    const startX = sourceBB.x + sourceBB.width / 2;
    const startY = sourceBB.y + sourceBB.height / 2;
    const endX   = targetBB.x + targetBB.width  / 2;
    const endY   = targetBB.y + 2; // just above TASK_1's centre

    // Step 1: position pointer over source
    await page.mouse.move(startX, startY);
    // Step 2: press — CDK starts drag on subsequent pointer movement
    await page.mouse.down();
    // Step 3: move incrementally, first crossing the threshold (small step),
    // then sweeping toward the drop target.
    await page.mouse.move(startX, startY - 3,  { steps: 3 });  // cross threshold
    await page.mouse.move(startX, startY - 10, { steps: 5 });  // continue moving
    await page.mouse.move(endX,   endY,         { steps: 20 }); // approach target
    // Brief settle — CDK recomputes container proximity during move
    await page.waitForTimeout(50);
    // Step 4: release — triggers the drop
    await page.mouse.up();

    // Allow Angular's change detection and the PATCH /position HTTP call to settle.
    // We do NOT assert on the pre-reload DOM order because optimistic update timing
    // varies; instead, the reload assert below is the ground truth.
    await page.waitForTimeout(500);

    // ── Persistence assertion ────────────────────────────────────────────────
    //
    // Reload the page so Angular re-fetches /schedule/period from the real backend.
    // If the PATCH persisted, the new order (TASK_2 first) should come back from
    // the server and render in that position.
    await page.reload();
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 10_000 });

    const slotListAfter = page.locator('.slot-drop-list').first();
    await expect(slotListAfter.getByText(TASK_1)).toBeVisible({ timeout: 5_000 });
    await expect(slotListAfter.getByText(TASK_2)).toBeVisible({ timeout: 5_000 });

    const taskRowsAfter = slotListAfter.locator('[data-testid="task-row"]');
    await expect(taskRowsAfter).toHaveCount(2, { timeout: 5_000 });

    // After dragging TASK_2 above TASK_1, TASK_2 must now be first.
    await expect(taskRowsAfter.first()).toContainText(TASK_2);
    await expect(taskRowsAfter.nth(1)).toContainText(TASK_1);
  });

});
