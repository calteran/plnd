import { test, expect } from '@playwright/test';

test.describe('Auth guard', () => {
  test('unauthenticated /dashboard visit redirects to /login', async ({ page }) => {
    // No token → guard sends to /login
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated user can access /dashboard', async ({ page }) => {
    // Use addInitScript to seed localStorage BEFORE Angular initializes.
    // tokenSignal reads localStorage once at class init time, so this must
    // run before Angular's DI bootstraps AuthService.
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('h2')).toHaveText('Dashboard');
  });
});
