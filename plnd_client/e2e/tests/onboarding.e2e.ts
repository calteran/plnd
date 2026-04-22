import { test, expect } from '@playwright/test';
import { API_BASE, MOCK_USER_NEW, MOCK_USER_ONBOARDED, MOCK_PREFS, MOCK_BRIEFING_WEATHER, MOCK_BRIEFING_NEWS, MOCK_BRIEFING_YESTERDAY } from '../helpers/auth';

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
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding/account');
    await expect(page).toHaveURL(/\/onboarding\/account/);
    await expect(page.locator('h1')).toHaveText('Account');
  });
});
