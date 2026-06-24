// e2e: keyboard/button reorder controls on the onboarding Task Placement Review substep.
//
// Seeds a new onboarding user (via seedOnboarding), seeds a day type with meal
// slots so the placement review renders section dividers, mocks /agent/place-tasks
// to return TWO tasks on the SAME day in the '<sched>' section (no after_anchor),
// navigates through the Tasks spoke to the placement-review substep, focuses the
// first task row to reveal the reorder controls, clicks 'reorder-down', and asserts
// the rendered order has swapped in-wizard (no reload — onboarding reorder is in-memory).
//
// Mock policy: ONLY /agent/place-tasks is mocked (LLM endpoint). Day-types and
// all other state flow through the real backend.
//
// Mirror of onboarding-placement-drag.e2e.ts: same auth/seeding boilerplate,
// same agent-mock route + response shape, same navigation path to placement review.
// Interaction differs: drag → keyboard (focus-revealed reorder-down button).

import { test, expect } from '../fixtures';
import { API_BASE } from '../helpers/auth';
import { seedOnboarding } from '../helpers/onboarding-mocks';
import { seedDayType, seedDayTypeMeal } from '../helpers/seed-data';

// Both tasks must share a date so they land in the SAME '<sched>' section drop
// list, making a within-section reorder possible. Use the same first-window date
// as the drag test.
const TEST_DATE = '2026-03-29'; // Sunday — first onboarding window

const TASK_A = 'Alpha Onboarding Task';
const TASK_B = 'Beta Onboarding Task';

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Onboarding Task Placement Review — keyboard reorder', () => {

  test('clicking reorder-down swaps two tasks in the same section in-wizard', async ({ page }) => {
    // ── Seed: new user + real backend day types ───────────────────────────────
    await page.clock.setSystemTime('2026-03-28T00:00:00');
    const { sub } = await seedOnboarding(page);

    // Seed a day type covering every day (bitmask 127) with three meal slots so
    // the placement review renders section dividers — identical to the drag test.
    const everyDay = await seedDayType(sub, {
      name: 'Every Day',
      days_bitmask: 127, // bits 0 (Sun) – 6 (Sat)
      wake_time: '08:00',
      sleep_time: '23:00',
    });
    await seedDayTypeMeal(sub, everyDay.id, { name: 'Breakfast', preferred_time: '08:00', sort_order: 0 });
    await seedDayTypeMeal(sub, everyDay.id, { name: 'Lunch',     preferred_time: '12:00', sort_order: 1 });
    await seedDayTypeMeal(sub, everyDay.id, { name: 'Dinner',    preferred_time: '18:00', sort_order: 2 });

    // ── Mock /agent/place-tasks (LLM endpoint — only mock allowed) ───────────
    //
    // Return BOTH tasks on TEST_DATE without after_anchor / paired_meal_name so
    // they both land in the '<sched>' section above the first meal divider.
    // TASK_A has an earlier time_window_start so buildDaySections places it first.
    await page.route(`${API_BASE}/agent/place-tasks`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            title:             TASK_A,
            scheduled_date:    TEST_DATE,
            time_window_start: '07:30',
            duration_minutes:  30,
            energy_required:   'high',
            task_type:         'general',
          },
          {
            title:             TASK_B,
            scheduled_date:    TEST_DATE,
            time_window_start: '08:00',
            duration_minutes:  45,
            energy_required:   'low',
            task_type:         'general',
          },
        ]),
      }),
    );

    // ── Navigate through Tasks spoke to Placement Review ─────────────────────
    await page.goto('/onboarding');
    await expect(page.locator('h1')).toHaveText('Welcome to PLND!');

    // Enter Tasks & Routines spoke (2nd card)
    await page.locator('.section-card').nth(1).click();
    await expect(page.locator('.spoke-title')).toHaveText('Tasks & Routines');

    // Step 1: Planning Prefs — accept defaults
    await expect(page.locator('.planning-prefs')).toBeVisible();
    await page.locator('.btn-continue').click();

    // Step 2: Schedule Types — wait for the seeded day type card to load BEFORE
    // saving, otherwise an empty day-types list is persisted and the placement
    // review renders no day cards.
    await expect(page.locator('.day-types-substep')).toBeVisible();
    await expect(page.locator('.schedule-card').first()).toBeVisible();
    await page.locator('.day-types-substep .save-btn').click();

    // Step 3: Routines & Tasks — add a task name so placement fires
    await expect(page.locator('.routines-tasks-substep')).toBeVisible();
    await page.locator('[aria-label="Task name"]').fill('Morning run');
    await page.locator('.add-btn').last().click();
    await expect(page.locator('[aria-label="Added tasks"] .routine-chip')).toHaveCount(1);
    await page.locator('.routines-tasks-substep .save-btn').click();

    // Step 4: Placement Review — wait for the mock response to render
    await expect(page.locator('.placement-review')).toBeVisible({ timeout: 10_000 });

    const firstDayCard = page.locator('.placement-review .day-card').first();
    await expect(firstDayCard).toBeVisible({ timeout: 10_000 });

    // Both tasks land in the '<sched>' section (first section in the day card,
    // above the Breakfast divider).
    const dropList = firstDayCard.locator('.section-drop-list').first();
    await expect(dropList).toBeVisible({ timeout: 10_000 });

    const taskItems = dropList.locator('.task-drag-item');
    await expect(taskItems).toHaveCount(2, { timeout: 10_000 });

    // ── Verify initial order ──────────────────────────────────────────────────
    //
    // TASK_A (earlier time_window_start '07:30') must be first.
    await expect(taskItems.nth(0)).toContainText(TASK_A);
    await expect(taskItems.nth(1)).toContainText(TASK_B);

    // ── Keyboard reorder via focus-revealed controls ──────────────────────────
    //
    // The reorder buttons are hidden until the row is :focus-within.
    // Bring the page to the foreground (required for reliable focus in headless
    // Chromium), focus the first row's .edit-btn to reveal the controls, then
    // click 'reorder-down' to move TASK_A below TASK_B.
    await page.bringToFront();
    const firstTaskRow = taskItems.nth(0).locator('.task-row');
    const editBtn = firstTaskRow.locator('.edit-btn');
    await editBtn.focus();

    // reorder-down button should now be visible (focus-within revealed it).
    const reorderDownBtn = firstTaskRow.getByTestId('reorder-down');
    await expect(reorderDownBtn).toBeVisible({ timeout: 3_000 });
    await reorderDownBtn.click();

    // Allow Angular change detection to propagate the signal update
    await page.waitForTimeout(200);

    // ── Post-move DOM assertion ───────────────────────────────────────────────
    //
    // After the optimistic in-memory move, TASK_B should now be first.
    const taskItemsAfter = dropList.locator('.task-drag-item');
    await expect(taskItemsAfter).toHaveCount(2, { timeout: 5_000 });
    await expect(taskItemsAfter.nth(0)).toContainText(TASK_B, { timeout: 5_000 });
    await expect(taskItemsAfter.nth(1)).toContainText(TASK_A, { timeout: 5_000 });

    // ── Focus-follows-task assertion (tolerant) ───────────────────────────────
    //
    // After the move, refocusReorderButton() applies focus to a control within
    // the moved task's row (TASK_A, now at index 1) via setTimeout(0).
    // Accept: reorder-up, reorder-down, or .edit-btn focused inside that row.
    // reorder-down is disabled when TASK_A is last; reorder-up is the expected
    // primary target. We tolerate any of those so the test doesn't break if the
    // refocus implementation lands on a different button.
    await page.waitForTimeout(100); // give setTimeout(0) time to run

    // Locate the moved task's row (TASK_A is now second)
    const movedItem = dropList.locator('.task-drag-item').nth(1);
    const movedRow  = movedItem.locator('.task-row');

    // Use evaluate to check document.activeElement is inside the moved row.
    const focusIsInMovedRow = await movedRow.evaluate(rowEl => {
      const active = document.activeElement;
      return active !== null && rowEl.contains(active);
    });

    if (!focusIsInMovedRow) {
      // Tolerant fallback: check the preferred targets individually.
      const upFocused   = await movedRow.getByTestId('reorder-up').evaluate(el => el.matches(':focus')).catch(() => false);
      const downFocused = await movedRow.getByTestId('reorder-down').evaluate(el => el.matches(':focus')).catch(() => false);
      const editFocused = await movedRow.locator('.edit-btn').evaluate(el => el.matches(':focus')).catch(() => false);
      expect(upFocused || downFocused || editFocused,
        'Expected focus on reorder-up, reorder-down, or .edit-btn within the moved (Alpha) row',
      ).toBe(true);
    }
  });

});
