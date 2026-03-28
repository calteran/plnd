import { test, expect } from '@playwright/test';
import { DayViewPage } from '../pages/day-view.page';
import { API_BASE, MOCK_USER_ONBOARDED, MOCK_PREFS, seedAuth } from '../helpers/auth';

// Test 1 requires full Docker stack: docker compose up -d db api mock-oauth-server
// Test 2 can run with only ng serve (uses addInitScript + route mocks).

test.describe('OAuth login flow', () => {
  test('completes full OIDC login and lands on dashboard', async ({ page }) => {
    // Mock the backend token exchange so the test does not require a running PLND API.
    // The Angular OIDC library still talks to the real mock OAuth server (port 8080)
    // to exchange the authorization code for an ID token — that is a real network call.
    await page.route(`${API_BASE}/auth/token`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
    await page.route(`${API_BASE}/auth/token`, route =>
      route.fulfill({
        status: 200,
        json: {
          access_token: 'synthetic.backend.jwt',
          token_type: 'Bearer',
          expires_in: 86400
        }
      })
    );

    // Mock /users/me so onboardingCompletedGuard resolves to true.
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER_ONBOARDED)
      })
    );

    // Navigate to the login page and trigger the OIDC flow.
    await page.goto('/login');
    await page.click('[data-testid="sign-in-button"], button:has-text("Sign In"), button:has-text("Log In")');

    // Playwright follows the cross-origin redirect chain:
    // Angular :4200 → Angular OIDC lib initiates code flow → mock OAuth :8080
    await page.waitForURL(/localhost:8080/, { timeout: 10_000 });

    // The mock OAuth server shows a username form.
    await page.fill('input[name="username"]', 'testuser');
    await page.click('input[type="submit"]');

    // mock-oauth2-server redirects to /auth/callback?code=...
    // AuthCallbackComponent exchanges the code for an ID token via the OIDC lib,
    // then POSTs to /auth/token (mocked above) to get the backend JWT.
    await page.waitForURL(/\/day\//, { timeout: 15_000 });
    await expect(page.locator('.schedule-view')).toBeVisible();
  });

  test('logout clears token and returns to /login', async ({ page }) => {
    // seedAuth seeds localStorage + mocks /users/me, /preferences/me, /schedule/plan/status.
    await seedAuth(page);

    // Mock the backend logout endpoint (AuthService makes a fire-and-forget call).
    await page.route(`${API_BASE}/auth/logout`, route =>
      route.fulfill({ status: 204 })
    );

    await page.goto('/today');
    await expect(page).toHaveURL(/\/day\//);

    const dayView = new DayViewPage(page);
    await dayView.signOut();

    await expect(page).toHaveURL(/\/login/);

    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeNull();
  });
});
