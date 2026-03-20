import { test, expect } from '@playwright/test';
import { DashboardPage } from '../pages/dashboard.page';

// Test 1 requires full Docker stack: docker compose up -d db api mock-oauth-server
// Test 2 can run with only ng serve (uses addInitScript + route mocks).

const MOCK_USER_ONBOARDED = {
  user_id: 'e2e-test-uuid',
  email: 'testuser@mock.plnd',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: true
};

test.describe('OAuth login flow', () => {
  test('completes full OIDC login and lands on dashboard', async ({ page }) => {
    // Mock the backend token exchange so the test does not require a running PLND API.
    // The Angular OIDC library still talks to the real mock OAuth server (port 8080)
    // to exchange the authorization code for an ID token — that is a real network call.
    await page.route('http://localhost:3000/auth/token', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'synthetic.backend.jwt',
          token_type: 'Bearer',
          expires_in: 86400
        })
      })
    );

    // Mock /users/me so onboardingCompletedGuard resolves to true.
    await page.route('http://localhost:3000/users/me', route =>
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
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page.locator('.schedule-view')).toBeVisible();
  });

  test('logout clears token and returns to /login', async ({ page }) => {
    // Seed the backend JWT into localStorage before Angular initialises,
    // mimicking a previously authenticated session.
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });

    // Mock /users/me for the onboardingCompletedGuard on /dashboard.
    await page.route('http://localhost:3000/users/me', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER_ONBOARDED)
      })
    );

    // Mock the backend logout endpoint (AuthService makes a fire-and-forget call).
    await page.route('http://localhost:3000/auth/logout', route =>
      route.fulfill({ status: 204 })
    );

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    const dashboard = new DashboardPage(page);
    await dashboard.signOut();

    await expect(page).toHaveURL(/\/login/);

    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeNull();
  });
});
