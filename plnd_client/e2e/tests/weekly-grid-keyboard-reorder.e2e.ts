// e2e: keyboard reorder of tasks in the planning wizard Day Review step (step 5).
//
// Seeds the wizard in step 5 with two tasks assigned to the same day, expands
// the day card, focuses the first task row to reveal the reorder controls, then
// clicks the reorder-down button. Asserts:
//   - the task order swapped (Beta is now first)
//   - the card is still expanded (stopPropagation on button click prevents collapse)
//   - focus followed the moved task (load-bearing: real activeElement check on the
//     moved row's reorder buttons or the row element itself — never forces focus)
//
// No page.route() mocks on /schedule/* — data flows through the real API.
// Per-test user isolation via seedAuth (unique sub per test).
// Per §9.7 mock policy: only /agent/* endpoints may be mocked.

import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { seedAuth, API_BASE } from '../helpers/auth';

const PLAN_START = '2026-03-30';
const PLAN_END   = '2026-04-05';
const TEST_DATE  = '2026-03-30'; // Monday — first card in the grid

const TASK_A = 'Alpha Wizard Task';
const TASK_B = 'Beta Wizard Task';

// ── Shared setup helpers ──────────────────────────────────────────────────────

/**
 * Seed localStorage with a step-5 wizard draft that has two tasks on TEST_DATE.
 * Both tasks land in the '<sched>' (unanchored) slot, so they appear in the
 * Tasks section of the expanded day card. Mirrors planning-drag.e2e.ts setup exactly.
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
            date:             args.date,
            task_type:        'general',
            title:            args.taskA,
            energy:           'low',
            after_anchor:     null,
            paired_meal_name: null,
          },
          {
            date:             args.date,
            task_type:        'general',
            title:            args.taskB,
            energy:           'high',
            after_anchor:     null,
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

test.describe('Planning Wizard Step 5 — keyboard reorder tasks in day card', () => {

  test('clicking reorder-down button swaps task order and keeps card expanded', async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedWizardStep5WithTwoTasks(page);

    await page.goto('/plan/week');
    await expect(page.locator('.planning-wizard')).toBeVisible();
    // Draft sets currentStep=5 — wizard should be on step 5
    await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('5', { timeout: 10_000 });

    // ── Expand the first day card ──────────────────────────────────────────────
    //
    // Cards are collapsed by default. Click the card header to expand it.
    const cards = page.locator('.day-card');
    await expect(cards).toHaveCount(7, { timeout: 10_000 });

    const mondayCard = cards.first();
    await expect(mondayCard).toBeVisible();

    await mondayCard.locator('.card-header').click();
    await expect(mondayCard).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });

    // ── Wait for task rows to appear ───────────────────────────────────────────
    const dropList = mondayCard.locator('.slot-drop-list').last(); // the <sched> drop list
    await expect(dropList).toBeVisible({ timeout: 5_000 });

    const taskItems = dropList.locator('.draggable-task');
    await expect(taskItems).toHaveCount(2, { timeout: 5_000 });

    // Assert initial order: TASK_A first, TASK_B second
    await expect(taskItems.nth(0).locator('.val')).toHaveText(TASK_A);
    await expect(taskItems.nth(1).locator('.val')).toHaveText(TASK_B);

    // ── Focus the first row to reveal reorder controls ─────────────────────────
    //
    // Bring the page to the foreground first — required for reliable programmatic
    // focus in headless Chromium (mirrors the pattern in onboarding-keyboard-reorder.e2e.ts).
    // Reorder buttons are visibility:hidden until the row is :focus-within.
    // The row has tabindex=0 so it can receive focus directly.
    await page.bringToFront();
    const firstRow = taskItems.nth(0);
    await firstRow.focus();

    // ── Click the reorder-down button on the first task ────────────────────────
    const reorderDownBtn = firstRow.getByTestId('reorder-down');
    await expect(reorderDownBtn).toBeVisible({ timeout: 3_000 });
    await reorderDownBtn.click();

    // Allow Angular change detection to propagate the signal update
    await page.waitForTimeout(200);

    // ── Assert order swapped ───────────────────────────────────────────────────
    const taskItemsAfter = dropList.locator('.draggable-task');
    await expect(taskItemsAfter).toHaveCount(2, { timeout: 5_000 });
    await expect(taskItemsAfter.nth(0).locator('.val')).toHaveText(TASK_B);
    await expect(taskItemsAfter.nth(1).locator('.val')).toHaveText(TASK_A);

    // ── Assert card is still expanded (button click did not collapse it) ────────
    await expect(mondayCard).toHaveAttribute('aria-expanded', 'true');

    // ── Focus-follows-task assertion (tolerant but load-bearing) ───────────────
    //
    // After the reorder, refocusReorderButton() in the component fires via
    // setTimeout(0): it focuses the moved task's always-visible row element (the
    // `.draggable-task`, tabindex=0) to reveal the controls, then focuses the
    // preferred reorder button (falling back to its sibling, else leaving focus
    // on the row). The moved task is TASK_A, now at index 1.
    //
    // This assertion is REAL — it only inspects document.activeElement / `:focus`
    // and NEVER calls Playwright `.focus()` itself. It accepts any of the legitimate
    // landing spots (reorder-up, reorder-down, or the row element) but MUST fail if
    // the component leaves focus on <body>. reorder-down is disabled when TASK_A is
    // last (index 1 of 2), so reorder-up is the expected primary target.
    await page.waitForTimeout(100); // give setTimeout(0) time to run

    // Locate the moved task's row (TASK_A moved down to index 1)
    const movedRow = taskItemsAfter.nth(1);

    // Check document.activeElement is the moved row itself or a control inside it.
    const focusIsInMovedRow = await movedRow.evaluate(rowEl => {
      const active = document.activeElement;
      return active !== null && (rowEl === active || rowEl.contains(active));
    });

    if (!focusIsInMovedRow) {
      // Tolerant fallback: check the preferred targets individually via :focus.
      // No forced focus — these are pure activeElement membership checks.
      const upFocused   = await movedRow.getByTestId('reorder-up').evaluate(el => el.matches(':focus')).catch(() => false);
      const downFocused = await movedRow.getByTestId('reorder-down').evaluate(el => el.matches(':focus')).catch(() => false);
      const rowFocused  = await movedRow.evaluate(el => el.matches(':focus')).catch(() => false);
      expect(upFocused || downFocused || rowFocused,
        'Expected focus on reorder-up, reorder-down, or the moved (Alpha) row element',
      ).toBe(true);
    }
  });

});
