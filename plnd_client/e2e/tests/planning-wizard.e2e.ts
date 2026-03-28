import { test, expect, Page } from '@playwright/test';
import { seedAuth, API_BASE, MOCK_USER_NEW, MOCK_PREFS } from '../helpers/auth';

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
      await page.locator('[aria-label="Next step"]').click();
      await page.locator('[aria-label="Next step"]').click();

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
      await expect(page.locator('[aria-label="Previous step"]')).not.toBeVisible();
    });

    test('Next button advances to the next step', async ({ page }) => {
      await page.locator('[aria-label="Next step"]').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');
    });

    test('Previous button returns to the prior step', async ({ page }) => {
      await page.locator('[aria-label="Next step"]').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('2');

      await page.locator('[aria-label="Previous step"]').click();
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('1');
    });

    test('Step 5 has no Next button', async ({ page }) => {
      // Navigate to step 5 by clicking Next four times
      for (let i = 0; i < 4; i++) {
        await page.locator('[aria-label="Next step"]').click();
      }
      await expect(page.locator('.progress-pill.active .pill-num')).toHaveText('5');
      await expect(page.locator('[aria-label="Next step"]')).not.toBeVisible();
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

      await page.locator('.btn-cancel').click();

      // /today guard immediately redirects to /day/:date
      await expect(page).toHaveURL(/\/day\//);

      // Draft must be wiped from localStorage
      const draft = await page.evaluate(() => localStorage.getItem('plnd:plan-draft'));
      expect(draft).toBeNull();
    });
  });

});
