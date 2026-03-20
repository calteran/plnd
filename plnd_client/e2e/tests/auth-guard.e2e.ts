import { test, expect } from '@playwright/test';

const MOCK_USER_ONBOARDED = {
  user_id: 'e2e-test-uuid',
  email: 'test@example.com',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: true
};

test.describe('Auth guard', () => {
  test('unauthenticated /today visit redirects to /login', async ({ page }) => {
    // No token → guard sends to /login
    await page.goto('/today');
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated user can access /today and lands on /day/:date', async ({ page }) => {
    // Mock /users/me so onboardingCompletedGuard resolves to true
    await page.route('http://localhost:3000/users/me', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
    );

    // Use addInitScript to seed localStorage BEFORE Angular initializes.
    // tokenSignal reads localStorage once at class init time, so this must
    // run before Angular's DI bootstraps AuthService.
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/today');
    await expect(page).toHaveURL(/\/day\//);
    await expect(page.locator('.schedule-view')).toBeVisible();
  });
});
