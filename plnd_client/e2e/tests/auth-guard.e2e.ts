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

const MOCK_PREFS = {
  user_id: 'e2e-test-uuid',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  week_start_day: 1,
  planning_trigger_offset: 0,
  default_plan_length_days: 7
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

    // MainLayoutComponent loads preferences and then checks plan status on init.
    // Without these mocks, the synthetic token gets a 401 from the real backend,
    // triggering authErrorInterceptor → logout('session_expired').
    await page.route('http://localhost:3000/preferences/me', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
    );
    await page.route('http://localhost:3000/schedule/plan/status**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ planned: false }) })
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
