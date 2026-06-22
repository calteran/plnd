// e2e: drag-reorder tasks on the onboarding Task Placement Review substep.
//
// Seeds a new onboarding user (via seedOnboarding), mocks /agent/place-tasks
// to return two tasks on the same day (same '<sched>' section), drives the
// Tasks spoke to the placement-review substep, drags the second task above
// the first within the section drop list, and asserts the reorder is reflected
// in-wizard immediately (before Save & Return).
//
// Mock policy: ONLY /agent/place-tasks is mocked (LLM endpoint). Day-types,
// routines, and all other state flow through the real backend.
//
// We do NOT verify the commit round-trip (Save & Return → /onboarding hub →
// planning wizard → day view) in this test: the onboarding-to-day-view path
// spans multiple pages and is covered by the onboarding.e2e.ts happy-path
// tests; the slot_position derivation in toPlanEntries() is unit-tested in
// task-placement-review-substep.spec.ts. A reliable narrow drag assertion
// beats a fragile full round-trip.

import { test, expect } from '../fixtures';
import { API_BASE } from '../helpers/auth';
import { seedOnboarding } from '../helpers/onboarding-mocks';
import { seedDayType, seedDayTypeMeal } from '../helpers/seed-data';

const TEST_DATE = '2026-03-29'; // Sunday — falls in first onboarding window

const TASK_A = 'Alpha Onboarding Task';
const TASK_B = 'Beta Onboarding Task';

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Onboarding Task Placement Review — drag-reorder', () => {

  test('dragging a task within a section drop list reorders it in-wizard', async ({ page }) => {
    // ── Seed: new user + real backend day types ───────────────────────────────
    await page.clock.setSystemTime('2026-03-28T00:00:00');
    const { sub } = await seedOnboarding(page);

    // Seed a day type with meal slots so the placement review renders
    // section dividers (matching the onboarding.e2e.ts pattern).
    const weekends = await seedDayType(sub, {
      name: 'Weekends',
      days_bitmask: 65, // Sat+Sun bits
      wake_time: '08:00',
      sleep_time: '23:00',
    });
    await seedDayTypeMeal(sub, weekends.id, { name: 'Breakfast', preferred_time: '08:00', sort_order: 0 });
    await seedDayTypeMeal(sub, weekends.id, { name: 'Lunch',     preferred_time: '12:00', sort_order: 1 });
    await seedDayTypeMeal(sub, weekends.id, { name: 'Dinner',    preferred_time: '18:00', sort_order: 2 });

    // ── Mock /agent/place-tasks (LLM endpoint — only mock allowed) ───────────
    //
    // Return two tasks on TEST_DATE without after_anchor / paired_meal_name so
    // both land in the '<sched>' section (unanchored) above the first meal
    // divider. This gives us a well-defined two-item drop list to drag within.
    await page.route(`${API_BASE}/agent/place-tasks`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            title:            TASK_A,
            scheduled_date:   TEST_DATE,
            time_window_start: '07:30',
            duration_minutes:  30,
            energy_required:  'high',
            task_type:        'general',
          },
          {
            title:            TASK_B,
            scheduled_date:   TEST_DATE,
            time_window_start: '08:00',
            duration_minutes:  45,
            energy_required:  'low',
            task_type:        'general',
          },
        ]),
      }),
    );

    // ── Navigate through Tasks spoke to Placement Review ────────────────────
    await page.goto('/onboarding');
    await expect(page.locator('h1')).toHaveText('Welcome to PLND!');

    // Enter Tasks & Routines spoke (2nd card)
    await page.locator('.section-card').nth(1).click();
    await expect(page.locator('.spoke-title')).toHaveText('Tasks & Routines');

    // Step 1: Planning Prefs — accept defaults
    await expect(page.locator('.planning-prefs')).toBeVisible();
    await page.locator('.btn-continue').click();

    // Step 2: Schedule Types — accept seeded Weekends day type as-is
    await expect(page.locator('.day-types-substep')).toBeVisible();
    await page.locator('.day-types-substep .save-btn').click();

    // Step 3: Routines & Tasks — add a task name so placement fires
    await expect(page.locator('.routines-tasks-substep')).toBeVisible();
    await page.locator('[aria-label="Task name"]').fill('Morning run');
    await page.locator('.add-btn').last().click();
    await expect(page.locator('[aria-label="Added tasks"] .routine-chip')).toHaveCount(1);
    await page.locator('.routines-tasks-substep .save-btn').click();

    // Step 4: Placement Review — wait for the mock response to render
    await expect(page.locator('.placement-review')).toBeVisible({ timeout: 10_000 });

    // Wait for the two mocked tasks to render in the drop list
    // Tasks land in the '<sched>' section (first section in each day card)
    const firstDayCard = page.locator('.placement-review .day-card').first();
    await expect(firstDayCard).toBeVisible({ timeout: 10_000 });

    const dropList = firstDayCard.locator('.section-drop-list').first();
    await expect(dropList).toBeVisible({ timeout: 10_000 });

    const taskItems = dropList.locator('.task-drag-item');
    await expect(taskItems).toHaveCount(2, { timeout: 10_000 });

    // Verify initial order: TASK_A first, TASK_B second
    await expect(taskItems.nth(0)).toContainText(TASK_A);
    await expect(taskItems.nth(1)).toContainText(TASK_B);

    // ── CDK drag via explicit mouse sequence ──────────────────────────────────
    //
    // Same proven pattern as day-view-drag.spec.ts (Task 10) and
    // planning-drag.spec.ts: mouse.move to source, mouse.down, incremental
    // moves past CDK threshold, mouse.up over target.
    const source = taskItems.nth(1); // TASK_B — drag this one up
    const target = taskItems.nth(0); // TASK_A — drop above this one

    const sourceBB = await source.boundingBox();
    const targetBB = await target.boundingBox();
    if (!sourceBB || !targetBB) throw new Error('Could not get bounding boxes for drag');

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
    // Assert within the live placement-review DOM. The onDrop() signal mutation
    // is synchronous — after CDK fires cdkDropListDropped and change detection
    // runs, TASK_B should now be first.
    const taskItemsAfter = firstDayCard.locator('.section-drop-list').first().locator('.task-drag-item');
    await expect(taskItemsAfter).toHaveCount(2, { timeout: 5_000 });
    await expect(taskItemsAfter.nth(0)).toContainText(TASK_B);
    await expect(taskItemsAfter.nth(1)).toContainText(TASK_A);
  });

});
