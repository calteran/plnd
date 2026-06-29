// e2e: a floating task can be dragged onto a meal to pair it (during-meal task),
// i.e. added to a meal that has no paired tasks yet.
//
// (Naming note: every e2e test must end in *.e2e.ts — Playwright's testMatch
// only collects that suffix; a *.spec.ts under e2e/ silently never runs. The
// `check-e2e-naming` guard enforces this; see #999.)
//
// A meal renders its paired tasks in a `.during-meal` CDK drop list. When the
// meal has no paired tasks that list collapses to zero height, so CDK's
// drop-target geometry (_canReceive → isInsideClientRect / elementFromPoint) can
// never match it — making it impossible to drag the FIRST task onto a meal. This
// is the meal-side twin of the empty-slot bug (#1000/#1001), and the fix is the
// same shape: a `min-height` gated on the `.schedule-list.dragging` class the day
// view adds synchronously at drag start, so the list has a hittable area before
// CDK caches its hit-rect. This test guards that the drop registers and persists.
//
// We seed a Breakfast anchor (no paired tasks) plus one floating task in the
// start-of-day slot, drag the task DOWN onto Breakfast's during-meal list, and
// assert it lands inside that list AND survives a reload — proving the drop
// registered and the PATCH /position round-trip persisted slot_meal_anchor_id.
//
// No page.route() mocks on /schedule/* — all data flows through the real API.
// Per-test user isolation via seedAuth (unique sub per test).

import { test, expect } from '../fixtures';
import { DayViewPage } from '../pages/day-view.page';
import { seedAuth } from '../helpers/auth';
import { seedMealAnchor, seedScheduleEntries } from '../helpers/seed-data';

const TEST_DATE  = '2026-05-06'; // Tuesday, within a clearly-bounded test window
const PLAN_START = '2026-05-05'; // Monday
const PLAN_END   = '2026-05-11'; // Sunday

const MORNING_TASK = 'Morning Task';

test.describe('Day View — drag a task onto a meal (pairing)', () => {

  test('a task drops into an empty meal during-meal list and persists as paired', async ({ page }) => {
    const { sub } = await seedAuth(page);

    // Breakfast anchor with NO paired tasks (its during-meal list starts empty —
    // the zero-height drop target the bug makes unhittable), plus one floating
    // task in the start-of-day slot ABOVE Breakfast to drag from.
    await seedMealAnchor(sub, { date: TEST_DATE, name: 'breakfast', preferred_time: '08:00' });
    await seedScheduleEntries(sub, {
      plan_start: PLAN_START,
      plan_end:   PLAN_END,
      placed_tasks: [
        {
          date:         TEST_DATE,
          task_type:    'general',
          title:        MORNING_TASK,
          after_anchor: 'start of day',
        },
      ],
    });

    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TEST_DATE);
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 10_000 });

    const mealRow = page.locator('app-meal-row');
    await expect(mealRow).toBeVisible({ timeout: 5_000 });

    const taskRow = page.locator('[data-testid="task-row"]', { hasText: MORNING_TASK });
    await expect(taskRow).toBeVisible({ timeout: 5_000 });

    const duringMeal = mealRow.locator('.during-meal').first();

    // Sanity: the task starts OUTSIDE the meal (no during-meal task rows yet).
    await expect(duringMeal.locator('[data-testid="task-row"]')).toHaveCount(0);

    // ── Drag the task DOWN onto Breakfast's during-meal list ──────────────────
    //
    // CDK needs a genuine pointer move past its drag threshold (≥ 5px from
    // mousedown), so we drive the pointer lifecycle by hand rather than dragTo().
    const taskBB = await taskRow.boundingBox();
    if (!taskBB) throw new Error('Could not get bounding box for the dragged task');

    const startX = taskBB.x + taskBB.width / 2;
    const startY = taskBB.y + taskBB.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 3,  { steps: 3 });  // cross CDK threshold
    await page.mouse.move(startX, startY + 12, { steps: 5 });  // .dragging now active

    // With the drag active the during-meal list has opened to its min-height, so
    // it now has a real (≥ ~24px) box we can target. Read it MID-DRAG.
    const dmBB = await duringMeal.evaluate(el => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    expect(dmBB.height).toBeGreaterThanOrEqual(20); // the fix is in effect
    const endX = dmBB.x + dmBB.width / 2;
    const endY = dmBB.y + dmBB.height / 2;

    await page.mouse.move(endX, endY, { steps: 25 }); // sweep onto the meal list
    await page.waitForTimeout(50); // settle proximity calc

    // Wait for the actual PATCH /position round-trip (armed before mouse.up so we
    // can't miss it) rather than a hardcoded timeout.
    const repositioned = page.waitForResponse(
      r => r.url().includes('/position') && r.request().method() === 'PATCH',
    );
    await page.mouse.up();
    await repositioned;

    // Optimistic: the task moved into the during-meal list.
    await expect(duringMeal.locator('[data-testid="task-row"]', { hasText: MORNING_TASK }))
      .toBeVisible({ timeout: 5_000 });

    // ── Persistence: reload so the order comes from the real backend ──────────
    await page.reload();
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 10_000 });
    await expect(mealRow).toBeVisible({ timeout: 5_000 });

    // The task is still inside the meal's during-meal list — proving the drop
    // persisted slot_meal_anchor_id (paired), not merely a transient client move.
    await expect(page.locator('app-meal-row .during-meal [data-testid="task-row"]', { hasText: MORNING_TASK }))
      .toBeVisible({ timeout: 5_000 });
  });

});
