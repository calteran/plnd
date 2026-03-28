import { test, expect } from '@playwright/test';
import { seedAuth } from '../helpers/auth';

test.describe('Auth guard', () => {
  test('unauthenticated /today visit redirects to /login', async ({ page }) => {
    // No token → guard sends to /login
    await page.goto('/today');
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated user can access /today and lands on /day/:date', async ({ page }) => {
    // seedAuth seeds localStorage + mocks /users/me, /preferences/me, /schedule/plan/status.
    // tokenSignal reads localStorage once at class init time, so addInitScript must run
    // before Angular's DI bootstraps AuthService — seedAuth handles this ordering.
    await seedAuth(page);
    await page.goto('/today');
    await expect(page).toHaveURL(/\/day\//);
    await expect(page.locator('.schedule-view')).toBeVisible();
  });
});
