// e2e: a task can be dragged onto a MEAL slot on the planning wizard Day Review
// step (step 5) — i.e. paired with a meal that has no tasks yet.
//
// Companion to planning-drag.e2e.ts (which reorders WITHIN the '<sched>' Tasks
// section). Here we drag the unanchored task UP into the empty Breakfast meal
// slot. The meal slot's CDK drop list was a flex sibling of the meal title
// (`.val{flex:1}`), squeezed to zero width — so paired tasks were invisible and,
// when empty, CDK's drop-target geometry could never match it, making it
// impossible to pair the FIRST task with a meal. The fix wraps the meal row so
// the drop list takes its own full-width line with a hittable min-height (mirrors
// the day view's floating-slot #1000/#1001 fix). This test guards the drop.
//
// No page.route() mocks on /schedule/* — data flows through the real API; only
// /agent/meal-plan (LLM) is mocked, per §9.7.

import { test, expect } from '../fixtures';
import type { Locator, Page } from '@playwright/test';
import { seedAuth, API_BASE } from '../helpers/auth';

/** Bounding box read only once the element has stopped moving (card expands via a
 *  max-height transition; reading mid-animation aims the drag at stale spots). */
async function stableBoundingBox(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  let prev = await locator.boundingBox();
  for (let i = 0; i < 30; i++) {
    await locator.page().waitForTimeout(50);
    const cur = await locator.boundingBox();
    if (
      prev && cur &&
      Math.abs(cur.x - prev.x) < 0.5 &&
      Math.abs(cur.y - prev.y) < 0.5 &&
      Math.abs(cur.width - prev.width) < 0.5 &&
      Math.abs(cur.height - prev.height) < 0.5
    ) {
      return cur;
    }
    prev = cur;
  }
  if (!prev) throw new Error('element never produced a bounding box');
  return prev;
}

const PLAN_START = '2026-03-30';
const PLAN_END   = '2026-04-05';
const TEST_DATE  = '2026-03-30'; // Monday — first card in the grid

const SCHED_TASK = 'Unanchored Wizard Task';

/** Seed a step-5 wizard draft with one unanchored task on TEST_DATE. */
async function seedWizardStep5WithOneTask(page: Page): Promise<{ sub: string }> {
  await page.route(`${API_BASE}/agent/meal-plan`, route =>
    route.fulfill({ status: 200, json: { week: PLAN_START, meals: [] } }),
  );

  await page.addInitScript(
    (args: { start: string; end: string; task: string; date: string }) => {
      localStorage.setItem('plnd:plan-draft', JSON.stringify({
        schemaVersion: 2,
        planStart: args.start,
        planEnd:   args.end,
        currentStep: 5,
        carryoverDecisions: {},
        scheduledMeals: {},
        scheduledTasks: [
          {
            date:             args.date,
            task_type:        'general',
            title:            args.task,
            energy:           'low',
            after_anchor:     null,
            paired_meal_name: null,
          },
        ],
        floatingTasks: [],
        savedAt: '2026-03-29T00:00:00.000Z',
      }));
    },
    { start: PLAN_START, end: PLAN_END, task: SCHED_TASK, date: TEST_DATE },
  );

  return seedAuth(page);
}

test.describe('Planning Wizard Step 5 — drag a task onto a meal', () => {

  test('dragging the unanchored task into the empty Breakfast meal slot pairs it', async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    // seedAuth's 'onboarded' preset already provisions an "Everyday" day type
    // (all 7 days) with breakfast/lunch/dinner meals, so the card's Meals section
    // renders those slots — no day-type seeding needed (and adding an overlapping
    // one 422s). Breakfast is sort_order 1, i.e. the first meal slot.
    await seedWizardStep5WithOneTask(page);

    await page.goto('/plan/week');
    await expect(page.locator('.planning-wizard')).toBeVisible();
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('5', { timeout: 10_000 });

    const cards = page.locator('.day-card');
    await expect(cards).toHaveCount(7, { timeout: 10_000 });

    const mondayCard = cards.first();
    await mondayCard.locator('.card-header').click();
    await expect(mondayCard).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });

    // Breakfast is the first meal slot (sort_order 0); the unanchored task lives
    // in the Tasks section's '<sched>' drop list (the last .slot-drop-list).
    const breakfastList = mondayCard.locator('.meal-slot-drop-list').first();
    const schedList     = mondayCard.locator('.slot-drop-list').last();
    await expect(breakfastList).toBeVisible({ timeout: 5_000 });

    const schedTask = schedList.locator('.draggable-task', { hasText: SCHED_TASK });
    await expect(schedTask).toHaveCount(1, { timeout: 5_000 });
    // Sanity: Breakfast slot starts empty.
    await expect(breakfastList.locator('.draggable-task')).toHaveCount(0);

    // ── Drag the unanchored task UP into the empty Breakfast meal slot ─────────
    const sourceBB = await stableBoundingBox(schedTask);
    const targetBB = await stableBoundingBox(breakfastList);

    // Directly guard the fix: the empty meal slot must be a hittable inline strip
    // (min-width 3rem, min-height 1rem) — kept within the row's text height so the
    // Tasks section below it does not shift. Without area CDK can't match it and
    // the drop below can never register; this fails fast if the strip regresses.
    expect(targetBB.height).toBeGreaterThanOrEqual(15);
    expect(targetBB.width).toBeGreaterThanOrEqual(40);

    const startX = sourceBB.x + sourceBB.width / 2;
    const startY = sourceBB.y + sourceBB.height / 2;
    const endX   = targetBB.x + targetBB.width / 2;
    const endY   = targetBB.y + targetBB.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 3,  { steps: 3 });  // cross CDK threshold
    await page.mouse.move(startX, startY - 10, { steps: 5 });
    await page.mouse.move(endX,   endY,         { steps: 20 }); // sweep onto Breakfast
    await page.waitForTimeout(80);
    await page.mouse.up();

    await page.waitForTimeout(200); // let the synchronous signal mutation render

    // ── In-wizard assertion: the task moved into Breakfast, out of '<sched>' ───
    await expect(
      mondayCard.locator('.meal-slot-drop-list').first().locator('.draggable-task', { hasText: SCHED_TASK }),
    ).toHaveCount(1, { timeout: 5_000 });
    await expect(
      mondayCard.locator('.slot-drop-list').last().locator('.draggable-task'),
    ).toHaveCount(0);
  });

});
