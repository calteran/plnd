// e2e: a task can be dragged onto a MEAL section on the onboarding Task
// Placement Review substep — i.e. paired with a meal that has no tasks yet.
//
// Companion to onboarding-placement-drag.e2e.ts (which reorders WITHIN the
// '<sched>' section). Here we drag the unanchored task DOWN into the empty
// Breakfast section. An empty meal section's drop list used to collapse to a
// sub-pixel height (min-height: 4px), which CDK's drop-target geometry can never
// match — so pairing the FIRST task with a meal was impossible. The fix gives
// '.section-drop-list' a reliably hittable min-height (mirrors the day view's
// floating-slot #1000/#1001 fix). This test guards that the cross-section drop
// registers.
//
// Mock policy: ONLY /agent/place-tasks is mocked (LLM endpoint). Day-types and
// all other state flow through the real backend.

import { test, expect } from '../fixtures';
import { API_BASE } from '../helpers/auth';
import { seedOnboarding } from '../helpers/onboarding-mocks';
import { seedDayType, seedDayTypeMeal } from '../helpers/seed-data';

const TEST_DATE = '2026-03-29'; // Sunday — falls in first onboarding window

const SCHED_TASK = 'Unanchored Task';

test.describe('Onboarding Task Placement Review — drag a task onto a meal', () => {

  test('dragging the unanchored task into the empty Breakfast section pairs it', async ({ page }) => {
    // ── Seed: new user + a day type with meal slots ───────────────────────────
    await page.clock.setSystemTime('2026-03-28T00:00:00');
    const { sub } = await seedOnboarding(page);

    // bitmask 127 covers all 7 days so activeDayTypeForDate() resolves for every
    // date in the plan window (an uncovered date throws and renders zero cards).
    const everyDay = await seedDayType(sub, {
      name: 'Every Day',
      days_bitmask: 127,
      wake_time: '08:00',
      sleep_time: '23:00',
    });
    await seedDayTypeMeal(sub, everyDay.id, { name: 'Breakfast', preferred_time: '08:00', sort_order: 0 });
    await seedDayTypeMeal(sub, everyDay.id, { name: 'Lunch',     preferred_time: '12:00', sort_order: 1 });
    await seedDayTypeMeal(sub, everyDay.id, { name: 'Dinner',    preferred_time: '18:00', sort_order: 2 });

    // ── Mock /agent/place-tasks: ONE unanchored task (lands in '<sched>') ──────
    await page.route(`${API_BASE}/agent/place-tasks`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            title:             SCHED_TASK,
            scheduled_date:    TEST_DATE,
            time_window_start: '07:30',
            duration_minutes:  30,
            energy_required:   'high',
            task_type:         'general',
          },
        ]),
      }),
    );

    // ── Navigate through the Tasks spoke to Placement Review ──────────────────
    await page.goto('/onboarding');
    await expect(page.locator('h1')).toHaveText('Welcome to PLND!');

    await page.locator('.section-card').nth(1).click();
    await expect(page.locator('.spoke-title')).toHaveText('Tasks & Routines');

    await expect(page.locator('.planning-prefs')).toBeVisible();
    await page.locator('.btn-continue').click();

    await expect(page.locator('.day-types-substep')).toBeVisible();
    await expect(page.locator('.schedule-card').first()).toBeVisible();
    await page.locator('.day-types-substep .save-btn').click();

    await expect(page.locator('.routines-tasks-substep')).toBeVisible();
    await page.locator('[aria-label="Task name"]').fill('Morning run');
    await page.locator('.add-btn').last().click();
    await expect(page.locator('[aria-label="Added tasks"] .routine-chip')).toHaveCount(1);
    await page.locator('.routines-tasks-substep .save-btn').click();

    await expect(page.locator('.placement-review')).toBeVisible({ timeout: 10_000 });

    const firstDayCard = page.locator('.placement-review .day-card').first();
    await expect(firstDayCard).toBeVisible({ timeout: 10_000 });

    // Sections render in order: '<sched>' (no divider), then Breakfast, Lunch,
    // Dinner (each preceded by a meal divider).
    const schedList     = firstDayCard.locator('.section-drop-list').nth(0);
    const breakfastList = firstDayCard.locator('.section-drop-list').nth(1);

    // Sanity: divider 1 is BREAKFAST, the task is in '<sched>', Breakfast is empty.
    await expect(firstDayCard.locator('.meal-label').first()).toHaveText('BREAKFAST');
    await expect(schedList.locator('.task-drag-item')).toHaveCount(1, { timeout: 10_000 });
    await expect(schedList.locator('.task-drag-item').first()).toContainText(SCHED_TASK);
    await expect(breakfastList.locator('.task-drag-item')).toHaveCount(0);

    // ── Drag the task DOWN into the empty Breakfast section ────────────────────
    const source = schedList.locator('.task-drag-item').first();
    const sourceBB = await source.boundingBox();
    // The empty Breakfast list already has a hittable min-height (permanent here),
    // so its resting box is a valid drop target.
    const targetBB = await breakfastList.boundingBox();
    if (!sourceBB || !targetBB) throw new Error('Could not get bounding boxes for drag');

    // Directly guard the fix: the empty meal section must have a hittable height
    // (min-height: 1.5rem). Without it the list is near-zero height and the drop
    // below can never register — this fails fast if the min-height regresses.
    expect(targetBB.height).toBeGreaterThanOrEqual(20);

    const startX = sourceBB.x + sourceBB.width / 2;
    const startY = sourceBB.y + sourceBB.height / 2;
    const endX   = targetBB.x + targetBB.width / 2;
    const endY   = targetBB.y + targetBB.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 3,  { steps: 3 });  // cross CDK threshold
    await page.mouse.move(startX, startY + 10, { steps: 5 });
    await page.mouse.move(endX,   endY,         { steps: 20 }); // sweep onto Breakfast
    await page.waitForTimeout(80);
    await page.mouse.up();

    await page.waitForTimeout(200); // let the synchronous signal mutation render

    // ── In-wizard assertion: the task moved into Breakfast, out of '<sched>' ───
    const schedAfter     = firstDayCard.locator('.section-drop-list').nth(0);
    const breakfastAfter = firstDayCard.locator('.section-drop-list').nth(1);
    await expect(breakfastAfter.locator('.task-drag-item', { hasText: SCHED_TASK }))
      .toHaveCount(1, { timeout: 5_000 });
    await expect(schedAfter.locator('.task-drag-item')).toHaveCount(0);
  });

});
