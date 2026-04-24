import { test, expect, Page } from '@playwright/test';
import {
  API_BASE, MOCK_USER_NEW, MOCK_USER_ONBOARDED, MOCK_PREFS,
  MOCK_BRIEFING_WEATHER, MOCK_BRIEFING_NEWS, MOCK_BRIEFING_YESTERDAY,
} from '../helpers/auth';
import {
  MOCK_SCHEDULE_TYPE_WEEKDAYS, MOCK_SCHEDULE_TYPE_WEEKENDS,
  MOCK_TEMPLATE_MORNING_WALK, MOCK_PLACED_TASKS, MOCK_MEAL_PLAN,
  MOCK_MEAL_HABIT, MOCK_DIETARY_RESTRICTION_ALLERGY,
  MOCK_DIETARY_RESTRICTION_INTOLERANCE, MOCK_PLAN_COMMITTED,
  seedOnboarding,
} from '../helpers/onboarding-mocks';

test.describe('Onboarding', () => {
  test('unauthenticated /onboarding visit redirects to /login', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated new user lands on onboarding hub', async ({ page }) => {
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_NEW) })
    );
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.locator('h1')).toHaveText('Welcome to PLND!');
  });

  test('authenticated returning user navigating to /onboarding redirects to /today', async ({ page }) => {
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
    );
    await page.route(`${API_BASE}/preferences/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
    );
    await page.route(`${API_BASE}/schedule/plan/status**`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ planned: false }) })
    );
    await page.route(`${API_BASE}/briefing/weather`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_BRIEFING_WEATHER) })
    );
    await page.route(`${API_BASE}/briefing/news`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_BRIEFING_NEWS) })
    );
    await page.route(`${API_BASE}/briefing/yesterday`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_BRIEFING_YESTERDAY) })
    );
    await page.route(`${API_BASE}/schedule/period**`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], carryover: [] }) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/day\//);
  });

  test('non-onboarded user navigating to /today is redirected to /onboarding', async ({ page }) => {
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_NEW) })
    );
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/today');
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test('new user can navigate to /onboarding/account child route', async ({ page }) => {
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_NEW) })
    );
    await page.route(`${API_BASE}/preferences/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
    );
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding/account');
    await expect(page).toHaveURL(/\/onboarding\/account/);
    await expect(page.locator('.spoke-title')).toHaveText('Account Settings');
  });

  // ── Hub behaviour ────────────────────────────────────────────────────────

  test.describe('Hub section grid', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.goto('/onboarding');
      await expect(page.locator('h1')).toHaveText('Welcome to PLND!');
    });

    test('renders 4 section cards: 3 not-started, Exercise disabled', async ({ page }) => {
      const cards = page.locator('.section-card');
      await expect(cards).toHaveCount(4);

      // Account, Tasks, Food — badge--muted (not started)
      const notStarted = page.locator('.card-badge.badge--muted');
      await expect(notStarted).toHaveCount(3);
      await expect(notStarted.nth(0)).toContainText('not started');

      // Exercise — disabled card + badge--disabled
      const exerciseCard = page.locator('.section-card--disabled');
      await expect(exerciseCard).toHaveCount(1);
      await expect(exerciseCard.locator('.card-badge.badge--disabled')).toContainText('coming soon');
    });

    test('Approve Plan → is ghost/disabled when 0 sections done', async ({ page }) => {
      const ghostCta = page.locator('.btn-cta.btn--ghost');
      await expect(ghostCta).toBeVisible();
      await expect(ghostCta).toContainText('Approve Plan →');
      await expect(ghostCta).toBeDisabled();
    });

    test('stats banner absent before all sections complete', async ({ page }) => {
      await expect(page.locator('.stats-banner')).not.toBeVisible();
    });

    test('entering account section navigates to /onboarding/account', async ({ page }) => {
      await page.locator('.section-card').first().click();
      await expect(page).toHaveURL(/\/onboarding\/account/);
    });

    test('← Hub link in spoke chrome returns to hub', async ({ page }) => {
      await page.goto('/onboarding/account');
      await page.locator('.hub-link').click();
      await expect(page).toHaveURL(/\/onboarding$/);
    });

    test('account section card shows ✓ done badge after account spoke completes', async ({ page }) => {
      // Mock account save endpoints
      await page.route(`${API_BASE}/users/me`, route => {
        if (route.request().method() === 'PATCH') {
          route.fulfill({ status: 200, json: { ...MOCK_USER_NEW, display_name: 'Test' } });
        } else {
          route.fulfill({ status: 200, json: MOCK_USER_NEW });
        }
      });

      // Navigate to account, save, return to hub
      await page.goto('/onboarding/account');
      await expect(page.locator('.spoke-title')).toHaveText('Account Settings');
      await page.locator('#displayName').fill('Test');
      await page.locator('.btn-continue').click();

      // Hub should show account card as done
      await expect(page).toHaveURL(/\/onboarding$/);
      const accountCard = page.locator('.section-card').first();
      await expect(accountCard.locator('.card-badge.badge--done')).toContainText('✓ done');
    });
  });
});
