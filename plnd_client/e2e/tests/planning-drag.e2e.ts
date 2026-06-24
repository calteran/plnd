// e2e: drag-reorder tasks on the planning wizard Day Review step (step 5).
//
// Seeds the wizard in step 5 with two tasks assigned to the same day, expands
// the day card, drags the second task above the first within the '<sched>'
// drop list, and asserts the reorder is reflected in-wizard.
//
// The commit → day-view round-trip assertion is NOT performed here: the wizard
// commit path (slot_position derivation + POST /schedule/plan persistence) is
// covered by the unit test `week-plan.service.spec.ts` (`buildCommitRequest`
// reflects reorderTask mutations) and by the planning-wizard-step4-5.e2e.ts
// Finish test (proves POST /schedule/plan succeeds end-to-end). A full round-trip
// e2e test would require navigating through 6 wizard steps + committing, making
// it fragile and duplicative of the existing coverage.
//
// No page.route() mocks on /schedule/* — data flows through the real API.
// Per-test user isolation via seedAuth (unique sub per test).

import { test, expect } from '../fixtures';
import type { Locator, Page } from '@playwright/test';
import { seedAuth, API_BASE } from '../helpers/auth';

/**
 * Resolves a locator's bounding box only once it has stopped moving. The day card
 * expands via a `max-height` CSS transition (~0.3s, plan-day-card.scss), so reading
 * coordinates immediately after `aria-expanded` flips would capture mid-animation
 * positions — the drag would then aim at stale spots and the reorder would silently
 * not register (unlike the day view, whose list has no expand animation). Polls
 * until two consecutive samples agree, so the drag math uses the settled layout.
 */
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
      // x/y AND width/height must settle: the drag path is built from the
      // element's centre (x + width/2, y + height/2), so a still-resizing box
      // would yield a wrong target point even once its origin stopped moving.
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

const TASK_A = 'Alpha Wizard Task';
const TASK_B = 'Beta Wizard Task';

// ── Shared setup helpers ──────────────────────────────────────────────────────

/**
 * Seed localStorage with a step-5 wizard draft that has two tasks on TEST_DATE.
 * Both tasks land in the '<sched>' (unanchored) slot, so they appear in the
 * Tasks section of the expanded day card.
 */
async function seedWizardStep5WithTwoTasks(page: Page): Promise<{ sub: string }> {
  // Mock agent/meal-plan — only LLM endpoints may be mocked per §9.7
  await page.route(`${API_BASE}/agent/meal-plan`, route =>
    route.fulfill({ status: 200, json: { week: PLAN_START, meals: [] } }),
  );

  // Inject the draft BEFORE injectAuthToken (addInitScript runs before page load)
  await page.addInitScript(
    (args: { start: string; end: string; taskA: string; taskB: string; date: string }) => {
      localStorage.setItem('plnd:plan-draft', JSON.stringify({
        schemaVersion: 2,
        planStart: args.start,
        planEnd:   args.end,
        currentStep: 5,
        carryoverDecisions: {},
        scheduledMeals: {},
        scheduledTasks: [
          {
            date:       args.date,
            task_type:  'general',
            title:      args.taskA,
            energy:     'low',
            after_anchor: null,
            paired_meal_name: null,
          },
          {
            date:       args.date,
            task_type:  'general',
            title:      args.taskB,
            energy:     'high',
            after_anchor: null,
            paired_meal_name: null,
          },
        ],
        floatingTasks: [],
        savedAt: '2026-03-29T00:00:00.000Z',
      }));
    },
    { start: PLAN_START, end: PLAN_END, taskA: TASK_A, taskB: TASK_B, date: TEST_DATE },
  );

  return seedAuth(page);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Planning Wizard Step 5 — drag-reorder tasks in day card', () => {

  test('dragging a task within the Tasks drop list reorders it in-wizard', async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedWizardStep5WithTwoTasks(page);

    await page.goto('/plan/week');
    await expect(page.locator('.planning-wizard')).toBeVisible();
    // Draft sets currentStep=5 — wizard should be on step 5
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('5', { timeout: 10_000 });

    // ── Expand the first day card ──────────────────────────────────────────────
    //
    // Cards are collapsed by default. We need to expand the Monday card so the
    // cdkDropList for the '<sched>' slot is mounted in the DOM.
    const cards = page.locator('.day-card');
    await expect(cards).toHaveCount(7, { timeout: 10_000 });

    const mondayCard = cards.first();
    await expect(mondayCard).toBeVisible();

    // Click card header region to expand (the card acts as a button)
    await mondayCard.locator('.card-header').click();
    await expect(mondayCard).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });

    // ── Wait for the Tasks section drop list to appear ─────────────────────────
    const dropList = mondayCard.locator('.slot-drop-list').last(); // the <sched> drop list (Tasks section)
    await expect(dropList).toBeVisible({ timeout: 5_000 });

    const taskItems = dropList.locator('.draggable-task');
    await expect(taskItems).toHaveCount(2, { timeout: 5_000 });

    // Verify initial order: TASK_A first, TASK_B second
    await expect(taskItems.nth(0)).toContainText(TASK_A);
    await expect(taskItems.nth(1)).toContainText(TASK_B);

    // ── CDK drag via explicit mouse sequence ──────────────────────────────────
    //
    // CDK requires a genuine pointer-move past its drag threshold (≥5 px). We
    // replicate the full pointer lifecycle rather than using locator.dragTo(),
    // which does not always cross the threshold reliably in headless Chromium.
    // Pattern proven in day-view-drag.e2e.ts (Task 10).
    const source = taskItems.nth(1); // TASK_B — drag this one up
    const target = taskItems.nth(0); // TASK_A — drop above this one

    // Read coordinates only after the card's expand animation has settled (see
    // stableBoundingBox) — otherwise CDK's drag-start rect cache and our target
    // point are computed from moving geometry and the drop lands nowhere.
    const sourceBB = await stableBoundingBox(source);
    const targetBB = await stableBoundingBox(target);

    const startX = sourceBB.x + sourceBB.width  / 2;
    const startY = sourceBB.y + sourceBB.height / 2;
    const endX   = targetBB.x + targetBB.width  / 2;
    const endY   = targetBB.y + 2; // just above TASK_A centre

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 3,  { steps: 3 });  // cross threshold
    await page.mouse.move(startX, startY - 10, { steps: 5 });
    await page.mouse.move(endX,   endY,         { steps: 20 });
    await page.waitForTimeout(80);
    await page.mouse.up();

    // Allow Angular change detection to propagate the signal update
    await page.waitForTimeout(200);

    // ── In-wizard assertion ────────────────────────────────────────────────────
    //
    // Assert within the live wizard DOM — no reload, no backend commit required.
    // The WeekPlanService.reorderTask() signal mutation is synchronous, so after
    // CDK fires cdkDropListDropped and change detection runs, the new order
    // should be immediately visible.
    const taskItemsAfter = mondayCard.locator('.slot-drop-list').last().locator('.draggable-task');
    await expect(taskItemsAfter).toHaveCount(2, { timeout: 5_000 });
    await expect(taskItemsAfter.nth(0)).toContainText(TASK_B);
    await expect(taskItemsAfter.nth(1)).toContainText(TASK_A);
  });

});
