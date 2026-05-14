import { test, expect, Page } from '@playwright/test';
import { seedAuth, API_BASE } from '../helpers/auth';
import { seedOnboarding } from '../helpers/onboarding-mocks';
import { seedScheduleEntries } from '../helpers/seed-data';

// Fixed date: 2026-03-28 (Saturday)
// seedAuth provisions an onboarded user with default prefs (week_start_day=1
// Monday, default_plan_length_days=7) and the "Everyday" day type with
// breakfast/lunch/dinner meal patterns.
// → plan_start = 2026-03-30, plan_end = 2026-04-05

async function seedWizard(page: Page): Promise<{ sub: string }> {
  const { sub } = await seedAuth(page);
  // Step 3 (Meals) auto-generates via the agent when no meals are stored. Mock
  // the agent endpoint so the skeleton resolves immediately without an LLM call
  // (mock policy: agent endpoints are the only thing we still mock).
  await page.route(`${API_BASE}/agent/meal-plan`, route =>
    route.fulfill({ status: 200, json: { week: '2026-03-30', meals: [] } })
  );
  return { sub };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Planning Wizard', () => {

  // ── Guards ─────────────────────────────────────────────────────────────────

  test.describe('Auth and onboarding guards', () => {
    test('unauthenticated /plan/week redirects to /login', async ({ page }) => {
      await page.goto('/plan/week');
      await expect(page).toHaveURL(/\/login/);
    });

    test('authenticated non-onboarded user is redirected to /onboarding', async ({ page }) => {
      // seedOnboarding provisions a fresh, non-onboarded user against the real
      // backend. /dietary-restrictions and /meal-pattern return empty for a new
      // user, so no route mocks are needed.
      await seedOnboarding(page);

      await page.goto('/plan/week');
      await expect(page).toHaveURL(/\/onboarding/);
    });
  });

  // ── Access ─────────────────────────────────────────────────────────────────

  test('authenticated onboarded user can access /plan/week and auto-skips to Step 2 when no carryover', async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedWizard(page);
    await page.goto('/plan/week');
    await expect(page.locator('.planning-wizard')).toBeVisible();
    // No carryover items → wizard auto-skips step 1 and lands on Tasks (step 2)
    await expect(page.locator('.progress-pill.active .pill-label')).toHaveText('Tasks');
  });

  // ── Progress indicator ─────────────────────────────────────────────────────

  test.describe('Progress indicator pills', () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime('2026-03-28T00:00:00');
      await seedWizard(page);
      await page.goto('/plan/week');
      await expect(page.locator('.planning-wizard')).toBeVisible();
      // Wait for the step 1 → step 2 auto-skip to settle before any
      // interaction; without this, a Next click can race the auto-skip and
      // be lost or interpreted against the wrong active step.
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');
    });

    test('Step 2 pill is active on first load (step 1 auto-skipped when no carryover)', async ({ page }) => {
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');
      // Step 1 pill should be disabled (faded) since carryover is empty
      await expect(page.locator('.progress-pill').nth(0)).toHaveClass(/disabled/);
    });

    test('active pill advances and done pills accumulate as user steps forward', async ({ page }) => {
      // Wizard starts on step 2 (step 1 auto-skipped).
      // Advance to step 3 via one Next click, then step 5 via a second click.
      await page.getByLabel('Next step').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('3');
      await expect(page.locator('.progress-pill.done')).toHaveCount(1);

      await page.getByLabel('Next step').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('5');
      await expect(page.locator('.progress-pill.done')).toHaveCount(2);
    });

    test('Exercise pill is visible and has the disabled class', async ({ page }) => {
      const pills = page.locator('.progress-pill');
      // Exercise is the 4th pill (index 3)
      await expect(pills.nth(3)).toHaveClass(/disabled/);
      await expect(pills.nth(3).locator('.pill-label')).toHaveText('Exercise');
    });
  });

  // ── Navigation buttons ─────────────────────────────────────────────────────

  test.describe('Navigation buttons', () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime('2026-03-28T00:00:00');
      await seedWizard(page);
      await page.goto('/plan/week');
      await expect(page.locator('.planning-wizard')).toBeVisible();
      // See Progress-indicator-pills beforeEach for rationale.
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');
    });

    test('Step 2 has no Previous button (step 1 is disabled)', async ({ page }) => {
      // Wizard starts on step 2; step 1 is disabled, so there is no previous enabled step
      await expect(page.getByLabel('Previous step')).not.toBeVisible();
    });

    test('Next button advances to the next step', async ({ page }) => {
      // Wizard starts on step 2; Next advances to step 3
      await page.getByLabel('Next step').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('3');
    });

    test('Previous button returns to the prior step', async ({ page }) => {
      // Wizard starts on step 2 (step 1 disabled/skipped). Advance to step 3 first.
      await page.getByLabel('Next step').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('3');

      // Back from step 3 returns to step 2 (not step 1, which is disabled)
      await page.getByLabel('Previous step').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');
    });

    test('Step 6 has no Next button', async ({ page }) => {
      // Wizard starts on step 2 (step 1 auto-skipped). Navigate to step 6 (Confirm).
      // Click 1: 2→3, Click 2: 3→5 (skips disabled Exercise), Click 3: 5→6
      for (let i = 0; i < 3; i++) {
        await page.getByLabel('Next step').click();
      }
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('6');
      await expect(page.getByLabel('Next step')).not.toBeVisible();
    });
  });

  // ── Step 1 — Carryover Review ─────────────────────────────────────────────

  test.describe('Step 1 — Carryover Review', () => {
    // Carryover entries are seeded into the previous week (2026-03-21 → 03-23)
    // by driving POST /tasks/weekly-plan + POST /schedule/plan against the real
    // backend. The /schedule/plan/carryover endpoint then returns them when the
    // wizard loads with plan_start=2026-03-30. Entries must be one_shot=false
    // so the window-close pass during commit_plan does not skip them.
    //
    // Note: task_type='medication' (rather than 'habit' as in the original
    // mock) because VALID_TASK_TYPES does not include 'habit'. The Step 1
    // "title falls back to task_type" test asserts on this literal text.

    async function seedWizardWithCarryover(page: Page): Promise<{ sub: string }> {
      const { sub } = await seedWizard(page);
      await seedScheduleEntries(sub, {
        plan_start: '2026-03-21',
        plan_end: '2026-03-23',
        placed_tasks: [
          {
            date: '2026-03-21',
            task_type: 'general',
            title: 'Morning run',
            scheduled_start: '07:00:00',
            one_shot: false,
          },
          {
            // No title — component should fall back to task_type
            date: '2026-03-22',
            task_type: 'medication',
            scheduled_start: '09:00:00',
            one_shot: false,
          },
          {
            date: '2026-03-23',
            task_type: 'general',
            title: 'Read book',
            scheduled_start: '20:00:00',
            one_shot: false,
          },
        ],
      });
      return { sub };
    }

    test('wizard auto-skips to step 2 when no carryover items', async ({ page }) => {
      await page.clock.setFixedTime('2026-03-28T00:00:00');
      await seedWizard(page); // no schedule entries → empty carryover
      await page.goto('/plan/week');
      await expect(page.locator('.planning-wizard')).toBeVisible();
      // Step 1 is skipped entirely — wizard opens on step 2 (Tasks)
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');
      await expect(page.locator('.progress-pill').nth(0)).toHaveClass(/disabled/);
    });

    test.describe('with carryover items', () => {
      test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime('2026-03-28T00:00:00');
        await seedWizardWithCarryover(page);
        await page.goto('/plan/week');
        await expect(page.locator('.carryover-list')).toBeVisible();
      });

      test('carryover items render with title, task-type fallback, and original date', async ({ page }) => {
        const items = page.locator('.carryover-item');
        await expect(items).toHaveCount(3);

        // Item with explicit title
        await expect(items.nth(0).locator('.item-title')).toHaveText('Morning run');
        await expect(items.nth(0).locator('.item-date')).toContainText('Mar 21');

        // Item without title falls back to task_type (no titlecase transform on this element)
        await expect(items.nth(1).locator('.item-title')).toHaveText('medication');

        // Third item
        await expect(items.nth(2).locator('.item-title')).toHaveText('Read book');
        await expect(items.nth(2).locator('.item-date')).toContainText('Mar 23');
      });

      test('decision badges default to Carry for all items', async ({ page }) => {
        const badges = page.locator('.decision-badge');
        await expect(badges).toHaveCount(3);
        for (let i = 0; i < 3; i++) {
          await expect(badges.nth(i)).toHaveAttribute('data-decision', 'carry');
          await expect(badges.nth(i)).toContainText('Carry');
        }
      });

      test('clicking badge cycles Carry → Defer → Drop → Carry', async ({ page }) => {
        const badge = page.locator('.decision-badge').first();

        // Initial state: Carry
        await expect(badge).toHaveAttribute('data-decision', 'carry');

        // Click 1: Carry → Defer
        await badge.click();
        await expect(badge).toHaveAttribute('data-decision', 'defer');
        await expect(badge).toContainText('Defer');

        // Click 2: Defer → Drop
        await badge.click();
        await expect(badge).toHaveAttribute('data-decision', 'drop');
        await expect(badge).toContainText('Drop');

        // Click 3: Drop → Carry (wraps around)
        await badge.click();
        await expect(badge).toHaveAttribute('data-decision', 'carry');
        await expect(badge).toContainText('Carry');
      });

      test('carryover decisions persist when navigating to Step 2 and back', async ({ page }) => {
        // Change first item to Defer, second to Drop
        const badges = page.locator('.decision-badge');
        await badges.nth(0).click(); // carry → defer
        await badges.nth(1).click(); // carry → defer
        await badges.nth(1).click(); // defer  → drop

        // Navigate to Step 2
        await page.getByLabel('Next step').click();
        await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');

        // Navigate back to Step 1
        await page.getByLabel('Previous step').click();
        await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('1');

        // Decisions should still be set
        await expect(page.locator('.decision-badge').nth(0)).toHaveAttribute('data-decision', 'defer');
        await expect(page.locator('.decision-badge').nth(1)).toHaveAttribute('data-decision', 'drop');
        await expect(page.locator('.decision-badge').nth(2)).toHaveAttribute('data-decision', 'carry');
      });
    });
  });

  // ── Step 2 — Tasks Planning ───────────────────────────────────────────────

  test.describe('Step 2 — Tasks Planning', () => {
    const MOCK_TASKS = [
      { title: 'Morning run', energy: 'high', date: '2026-03-30', task_type: 'general' },
      { title: 'Read book',   energy: 'low',  date: '2026-03-30', task_type: 'general' },
    ];

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime('2026-03-28T00:00:00');
      await page.addInitScript((tasks) => {
        localStorage.setItem('plnd:plan-draft', JSON.stringify({
          schemaVersion: 2,
          planStart: '2026-03-30',
          planEnd: '2026-04-05',
          currentStep: 2,
          carryoverDecisions: {},
          scheduledMeals: {},
          scheduledTasks: tasks,
          floatingTasks: [],
          savedAt: '2026-03-29T00:00:00.000Z',
        }));
      }, MOCK_TASKS);
      await seedWizard(page);
      await page.goto('/plan/week');
      await expect(page.locator('.planning-wizard')).toBeVisible();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');
    });

    test('daily accordions render one entry per horizon day', async ({ page }) => {
      await expect(page.locator('.day-accordion')).toHaveCount(7);
    });

    test('accordion header shows day name, date, and task count badge', async ({ page }) => {
      const first = page.locator('.day-accordion').nth(0);
      await expect(first.locator('.day-name')).toHaveText('MON');
      await expect(first.locator('.day-date')).toContainText('Mar 30');
      await expect(first.locator('.task-badge')).toHaveText('2 tasks');

      const second = page.locator('.day-accordion').nth(1);
      await expect(second.locator('.task-badge')).toHaveText('0 tasks');
    });

    test('clicking accordion header collapses and re-expands it', async ({ page }) => {
      const first = page.locator('.day-accordion').nth(0);
      // Horizon ≤ 7 → auto-expanded on load
      await expect(first).toHaveClass(/open/);

      // Click to collapse
      await first.locator('.day-accordion__header').click();
      await expect(first).not.toHaveClass(/open/);

      // Click to re-expand
      await first.locator('.day-accordion__header').click();
      await expect(first).toHaveClass(/open/);
    });

    test('task row shows title and energy level badge', async ({ page }) => {
      const first = page.locator('.day-accordion').nth(0);
      const rows = first.locator('.task-row');
      await expect(rows).toHaveCount(2);

      await expect(rows.nth(0).locator('.task-title')).toHaveText('Morning run');
      await expect(rows.nth(0).locator('.energy-badge.energy-high')).toBeVisible();

      await expect(rows.nth(1).locator('.task-title')).toHaveText('Read book');
      await expect(rows.nth(1).locator('.energy-badge.energy-low')).toBeVisible();
    });

    test('adding a task to a day appends it to that day list', async ({ page }) => {
      await page.route(`${API_BASE}/agent/task`, route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ actions_taken: [{ type: 'task_created', task_id: 'e2e-task-3' }], ui_signals: [], confirmation: 'Task added!' }),
        }),
      );

      // Target the second accordion (2026-03-31) — starts empty
      const second = page.locator('.day-accordion').nth(1);
      const addAffordance = second.locator('.add-affordance');

      await addAffordance.locator('.add-row').click();
      await addAffordance.locator('.entry-input').fill('Walk the dog');
      await addAffordance.locator('.btn-add').click();

      const rows = second.locator('.task-row');
      await expect(rows).toHaveCount(1);
      await expect(rows.nth(0).locator('.task-title')).toHaveText('Walk the dog');
      await expect(rows.nth(0).locator('.energy-badge')).toBeVisible();
    });

    test('remove button removes a task from the day list', async ({ page }) => {
      const first = page.locator('.day-accordion').nth(0);
      const rows = first.locator('.task-row');
      await expect(rows).toHaveCount(2);

      // Remove the first task ("Morning run")
      await rows.nth(0).locator('.task-remove').click();

      await expect(rows).toHaveCount(1);
      await expect(rows.nth(0).locator('.task-title')).toHaveText('Read book');
    });

    test('floating tasks panel renders with floating title and hint', async ({ page }) => {
      await expect(page.locator('.floating-panel')).toBeVisible();
      await expect(page.locator('.floating-title')).toContainText('FLOATING TASKS');
      await expect(page.locator('.floating-hint')).toBeVisible();
    });

    test('adding a floating task appends it to the floating list', async ({ page }) => {
      await page.route(`${API_BASE}/agent/task`, route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ actions_taken: [{ type: 'task_created', task_id: 'e2e-task-4' }], ui_signals: [], confirmation: 'Task added!' }),
        }),
      );

      const floatAdd = page.locator('.float-add-affordance');

      await floatAdd.locator('.add-row').click();
      await floatAdd.locator('.entry-input').fill('Buy groceries');
      await floatAdd.locator('.btn-add').click();

      const rows = page.locator('.floating-task-row');
      await expect(rows).toHaveCount(1);
      await expect(rows.nth(0).locator('.task-title')).toHaveText('Buy groceries');
      await expect(rows.nth(0).locator('.floating-badge')).toBeVisible();
    });

  });

});
