import { test, expect, Page } from '@playwright/test';
import { seedAuth, API_BASE, MOCK_USER_NEW } from '../helpers/auth';

// Fixed date: 2026-03-28 (Saturday)
// MOCK_PREFS: week_start_day=1 (Monday), default_plan_length_days=7
// → plan_start = 2026-03-30, plan_end = 2026-04-05

async function seedWizard(page: Page): Promise<void> {
  await seedAuth(page);
  await page.route(`${API_BASE}/tasks/weekly-plan**`, route =>
    route.fulfill({ status: 200, json: { task_id: 'test-planning-task' } })
  );
  await page.route(`${API_BASE}/schedule/period**`, route =>
    route.fulfill({
      status: 200,
      json: { carryover: [], entries: [] },
    })
  );
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
      await page.addInitScript(() => {
        localStorage.setItem('auth_token', 'synthetic.test.token');
      });
      await page.route(`${API_BASE}/users/me`, route =>
        route.fulfill({ status: 200, json: MOCK_USER_NEW })
      );
      // OnboardingComponent fetches dietary-restrictions on load; mock it so the
      // synthetic token does not trigger a real 401 → session_expired redirect.
      await page.route(`${API_BASE}/dietary-restrictions`, route =>
        route.fulfill({ status: 200, json: [] })
      );

      await page.goto('/plan/week');
      await expect(page).toHaveURL(/\/onboarding/);
    });
  });

  // ── Access ─────────────────────────────────────────────────────────────────

  test('authenticated onboarded user can access /plan/week and sees Step 1', async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedWizard(page);
    await page.goto('/plan/week');
    await expect(page.locator('.planning-wizard')).toBeVisible();
    // The Carryover pill is the Step 1 label
    await expect(page.locator('.progress-pill.active .pill-label')).toHaveText('Carryover');
  });

  // ── Progress indicator ─────────────────────────────────────────────────────

  test.describe('Progress indicator pills', () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime('2026-03-28T00:00:00');
      await seedWizard(page);
      await page.goto('/plan/week');
      await expect(page.locator('.planning-wizard')).toBeVisible();
    });

    test('Step 1 pill is active on first load', async ({ page }) => {
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('1');
    });

    test('active pill advances and done pills accumulate as user steps forward', async ({ page }) => {
      // Advance to step 3 via two Next clicks
      await page.getByLabel('Next step').click();
      await page.getByLabel('Next step').click();

      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('3');
      await expect(page.locator('.progress-pill.done')).toHaveCount(2);
    });
  });

  // ── Navigation buttons ─────────────────────────────────────────────────────

  test.describe('Navigation buttons', () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime('2026-03-28T00:00:00');
      await seedWizard(page);
      await page.goto('/plan/week');
      await expect(page.locator('.planning-wizard')).toBeVisible();
    });

    test('Step 1 has no Previous button', async ({ page }) => {
      await expect(page.getByLabel('Previous step')).not.toBeVisible();
    });

    test('Next button advances to the next step', async ({ page }) => {
      await page.getByLabel('Next step').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');
    });

    test('Previous button returns to the prior step', async ({ page }) => {
      await page.getByLabel('Next step').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');

      await page.getByLabel('Previous step').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('1');
    });

    test('Step 5 has no Next button', async ({ page }) => {
      // Navigate to step 5 by clicking Next four times
      for (let i = 0; i < 4; i++) {
        await page.getByLabel('Next step').click();
      }
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('5');
      await expect(page.getByLabel('Next step')).not.toBeVisible();
    });
  });

  // ── Step 1 — Carryover Review ─────────────────────────────────────────────

  test.describe('Step 1 — Carryover Review', () => {
    // Mock carryover entries from the previous week (2026-03-21 → 2026-03-23)
    const MOCK_CARRYOVER = [
      {
        entry_id: 'co-1',
        task_type: 'custom',
        title: 'Morning run',
        date: '2026-03-21',
        scheduled_start: '07:00:00',
        status: 'incomplete',
      },
      {
        // No title — component should fall back to task_type
        entry_id: 'co-2',
        task_type: 'habit',
        date: '2026-03-22',
        scheduled_start: '09:00:00',
        status: 'incomplete',
      },
      {
        entry_id: 'co-3',
        task_type: 'custom',
        title: 'Read book',
        date: '2026-03-23',
        scheduled_start: '20:00:00',
        status: 'incomplete',
      },
    ];

    async function seedWizardWithCarryover(page: Page): Promise<void> {
      await seedWizard(page);
      // Override period route (LIFO — this handler runs before seedWizard's empty mock)
      await page.route(`${API_BASE}/schedule/period**`, route =>
        route.fulfill({
          status: 200,
          json: { entries: [], carryover: MOCK_CARRYOVER },
        })
      );
    }

    test('empty state shows celebration emoji and message when no carryover', async ({ page }) => {
      await page.clock.setFixedTime('2026-03-28T00:00:00');
      await seedWizard(page); // returns carryover: []
      await page.goto('/plan/week');
      await expect(page.locator('.planning-wizard')).toBeVisible();
      await expect(page.locator('.empty-state')).toBeVisible();
      await expect(page.locator('.empty-emoji')).toContainText('🎉');
      await expect(page.locator('.carryover-list')).not.toBeVisible();
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
        await expect(items.nth(1).locator('.item-title')).toHaveText('habit');

        // Third item
        await expect(items.nth(2).locator('.item-title')).toHaveText('Read book');
        await expect(items.nth(2).locator('.item-date')).toContainText('Mar 23');
      });

      test('decision badges default to Accept for all items', async ({ page }) => {
        const badges = page.locator('.decision-badge');
        await expect(badges).toHaveCount(3);
        for (let i = 0; i < 3; i++) {
          await expect(badges.nth(i)).toHaveAttribute('data-decision', 'accept');
          await expect(badges.nth(i)).toContainText('Accept');
        }
      });

      test('clicking badge cycles Accept → Defer → Dismiss → Accept', async ({ page }) => {
        const badge = page.locator('.decision-badge').first();

        // Initial state: Accept
        await expect(badge).toHaveAttribute('data-decision', 'accept');

        // Click 1: Accept → Defer
        await badge.click();
        await expect(badge).toHaveAttribute('data-decision', 'defer');
        await expect(badge).toContainText('Defer');

        // Click 2: Defer → Dismiss
        await badge.click();
        await expect(badge).toHaveAttribute('data-decision', 'dismiss');
        await expect(badge).toContainText('Dismiss');

        // Click 3: Dismiss → Accept (wraps around)
        await badge.click();
        await expect(badge).toHaveAttribute('data-decision', 'accept');
        await expect(badge).toContainText('Accept');
      });

      test('carryover decisions persist when navigating to Step 2 and back', async ({ page }) => {
        // Change first item to Defer, second to Dismiss
        const badges = page.locator('.decision-badge');
        await badges.nth(0).click(); // accept → defer
        await badges.nth(1).click(); // accept → defer
        await badges.nth(1).click(); // defer  → dismiss

        // Navigate to Step 2
        await page.getByLabel('Next step').click();
        await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');

        // Navigate back to Step 1
        await page.getByLabel('Previous step').click();
        await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('1');

        // Decisions should still be set
        await expect(page.locator('.decision-badge').nth(0)).toHaveAttribute('data-decision', 'defer');
        await expect(page.locator('.decision-badge').nth(1)).toHaveAttribute('data-decision', 'dismiss');
        await expect(page.locator('.decision-badge').nth(2)).toHaveAttribute('data-decision', 'accept');
      });
    });
  });

  // ── Cancel flow ────────────────────────────────────────────────────────────

  test.describe('Cancel flow', () => {
    test('Cancel button clears the draft and redirects to /today', async ({ page }) => {
      await page.clock.setFixedTime('2026-03-28T00:00:00');
      await page.addInitScript(() => {
        // Pre-seed a draft so we can verify it gets wiped on cancel
        localStorage.setItem('plnd:plan-draft', JSON.stringify({
          schemaVersion: 1,
          planStart: '2026-03-30',
          planEnd: '2026-04-05',
          currentStep: 2,
          carryoverDecisions: {},
          scheduledMeals: {},
          scheduledTasks: [],
          floatingTasks: [],
          savedAt: '2026-03-28T00:00:00.000Z',
        }));
      });
      await seedWizard(page);

      await page.goto('/plan/week');
      await expect(page.locator('.planning-wizard')).toBeVisible();

      await page.getByRole('button', { name: 'Cancel' }).click();

      // /today guard immediately redirects to /day/:date
      await expect(page).toHaveURL(/\/day\//);

      // Draft must be wiped from localStorage
      const draft = await page.evaluate(() => localStorage.getItem('plnd:plan-draft'));
      expect(draft).toBeNull();
    });
  });

});
