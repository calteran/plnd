import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

// Requires full Docker stack: docker compose up -d db api mock-oauth-server

test.describe('OAuth login flow', () => {
  test('completes full login redirect chain and lands on dashboard', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.clickSignIn();

    // Playwright follows the full cross-origin chain:
    // Angular :4200 → API :3000 → mock OAuth :8080 → API :3000 → Angular :4200
    await page.waitForURL(/localhost:8080/, { timeout: 10_000 });

    // mock-oauth2-server shows a username form; submit button is input[type="submit"]
    await page.fill('input[name="username"]', 'testuser');
    await page.click('input[type="submit"]');

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page.locator('h2')).toHaveText('Dashboard');
  });

  test('logout clears token and returns to /login', async ({ page }) => {
    // Navigate via /auth/callback — tests the real handleCallback() path
    // and properly initializes the tokenSignal via AuthService.handleCallback()
    await page.goto('/auth/callback?token=synthetic.test.token');
    await expect(page).toHaveURL(/\/dashboard/);

    const dashboard = new DashboardPage(page);
    await dashboard.getSignOutButton().click();
    await expect(page).toHaveURL(/\/login/);

    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeNull();
  });
});
