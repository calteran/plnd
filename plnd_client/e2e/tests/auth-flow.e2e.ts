import { test, expect } from '../fixtures';
import { DayViewPage } from '../pages/day-view.page';
import { seedAuth, seedTestState } from '../helpers/auth';

// Both tests require the full stack (db, mock-oauth-server, plnd_api) — e2e
// tests now mint real backend JWTs via the OIDC → /auth/token exchange.
// `just verify` and `just dev` bring this up; standalone playwright runs need
// `just api` or `just dev` first.

test.describe('OAuth login flow', () => {
  test('completes full OIDC login and lands on dashboard', async ({ page }) => {
    // Pre-seed the user that mock-oauth-server will return for the username
    // 'testuser' (the mock issues an id_token whose `sub` claim is the
    // username field). Marking it as onboarded means onboardingCompletedGuard
    // resolves to true after the OIDC code-flow → /auth/token exchange runs
    // entirely against the real backend.
    await seedTestState('testuser', { preset: 'onboarded' });

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
    // then POSTs to the real /auth/token to get the backend JWT.
    await page.waitForURL(/\/day\//, { timeout: 15_000 });
    await expect(page.locator('.schedule-view')).toBeVisible({ timeout: 15_000 });
  });

  test('logout clears token and returns to /login', async ({ page }) => {
    // seedAuth sets up an onboarded user against the real backend.
    await seedAuth(page);

    await page.goto('/today');
    await expect(page).toHaveURL(/\/day\//);

    const dayView = new DayViewPage(page);
    await dayView.signOut();

    await expect(page).toHaveURL(/\/login/);

    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeNull();
  });
});
