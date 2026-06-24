// e2e: keyboard/button reorder controls on the day view persist via the backend.
//
// Seeds a single day with TWO floating tasks in the same slot ('start of day'),
// focuses the first task row to reveal the reorder controls, clicks the
// 'reorder-down' button, asserts the DOM order has swapped, asserts focus has
// followed the moved task, reloads the page, and asserts the new order is
// reflected from the backend — proving the PATCH /schedule/entries/{id}/position
// round-trip persisted.
//
// No page.route() mocks on /schedule/* — all data flows through the real API.
// Per-test user isolation via seedAuth (unique sub per test).

import { test, expect } from '../fixtures';
import { DayViewPage } from '../pages/day-view.page';
import { seedAuth } from '../helpers/auth';
import { seedScheduleEntries } from '../helpers/seed-data';

const TEST_DATE  = '2026-03-19'; // Thursday, within a clearly-bounded test window
const PLAN_START = '2026-03-16'; // Monday
const PLAN_END   = '2026-03-22'; // Sunday

const TASK_1 = 'Alpha Task';
const TASK_2 = 'Beta Task';

test.describe('Day View — keyboard reorder controls', () => {

  test('reorders a floating task down via the reorder-down button and persists across reload', async ({ page }) => {
    const { sub } = await seedAuth(page);

    // Seed two floating tasks in the 'start of day' slot in known order:
    //   slot_position 0 → TASK_1 ("Alpha Task")
    //   slot_position 1 → TASK_2 ("Beta Task")
    await seedScheduleEntries(sub, {
      plan_start: PLAN_START,
      plan_end:   PLAN_END,
      placed_tasks: [
        {
          date:         TEST_DATE,
          task_type:    'general',
          title:        TASK_1,
          after_anchor: 'start of day',
          slot_position: 0,
        },
        {
          date:         TEST_DATE,
          task_type:    'general',
          title:        TASK_2,
          after_anchor: 'start of day',
          slot_position: 1,
        },
      ],
    });

    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TEST_DATE);

    // Wait for the schedule list to be visible and both tasks to appear.
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 10_000 });

    const slotList = page.locator('.slot-drop-list').first();
    await expect(slotList).toBeVisible({ timeout: 5_000 });

    await expect(slotList.getByText(TASK_1)).toBeVisible({ timeout: 5_000 });
    await expect(slotList.getByText(TASK_2)).toBeVisible({ timeout: 5_000 });

    const taskRows = slotList.locator('[data-testid="task-row"]');
    await expect(taskRows).toHaveCount(2, { timeout: 5_000 });

    // Verify initial order: TASK_1 first, TASK_2 second.
    await expect(taskRows.first()).toContainText(TASK_1);
    await expect(taskRows.nth(1)).toContainText(TASK_2);

    // ── Keyboard reorder via focus-revealed controls ─────────────────────────
    //
    // The reorder buttons are hidden until the row is :focus-within.
    // Ensure the page has OS-level focus (required for focus assertions to work
    // in headless Chromium), then focus the label of the first row to reveal
    // the controls, and click its 'reorder-down' button to move it below TASK_2.
    await page.bringToFront();
    const firstRow = taskRows.first();
    await firstRow.locator('.label').focus();

    // reorder-down button should now be visible (focus-within revealed it).
    const reorderDownBtn = firstRow.getByTestId('reorder-down');
    await expect(reorderDownBtn).toBeVisible({ timeout: 3_000 });
    await reorderDownBtn.click();

    // ── Post-move DOM assertion ───────────────────────────────────────────────
    //
    // After the optimistic move, TASK_2 should now be first.
    const taskRowsAfterMove = slotList.locator('[data-testid="task-row"]');
    await expect(taskRowsAfterMove.first()).toContainText(TASK_2, { timeout: 5_000 });
    await expect(taskRowsAfterMove.nth(1)).toContainText(TASK_1, { timeout: 5_000 });

    // ── Focus-follows-task assertion ─────────────────────────────────────────
    //
    // After the move, the day-view wiring (refocusReorderButton) applies focus
    // to a control within the moved task's row via setTimeout(0). The moved row
    // is TASK_1 (Alpha Task), now at slot_position 1 (second).
    //
    // The reorder-down button is disabled at the list bottom; reorder-up is the
    // expected focus target. We use expect(locator).toBeFocused() which Playwright
    // evaluates via the accessibility tree — works reliably in headless Chromium.
    // Note: after networkidle fires, the applyPendingFocus setTimeout(0) has run.
    await page.waitForLoadState('networkidle');
    const movedRowHost = page.locator('[id^="task-row-"]').filter({ hasText: TASK_1 });
    // Prefer reorder-up (natural target when task is last — down is disabled).
    // Fall through to reorder-down or label if the implementation lands differently.
    const reorderUpInMoved = movedRowHost.getByTestId('reorder-up');
    await expect(reorderUpInMoved).toBeFocused({ timeout: 3_000 })
      .catch(async () => {
        // If reorder-up isn't focused, accept reorder-down or .label.
        const downFocused = await movedRowHost.getByTestId('reorder-down').evaluate(el => el.matches(':focus'));
        const lblFocused  = await movedRowHost.locator('.label').evaluate(el => el.matches(':focus'));
        expect(downFocused || lblFocused,
          'Expected focus on reorder-up, reorder-down, or .label in the moved (Alpha Task) row'
        ).toBe(true);
      });

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

    // After reordering TASK_1 down below TASK_2, TASK_2 must now be first.
    await expect(taskRowsAfter.first()).toContainText(TASK_2);
    await expect(taskRowsAfter.nth(1)).toContainText(TASK_1);
  });

});
