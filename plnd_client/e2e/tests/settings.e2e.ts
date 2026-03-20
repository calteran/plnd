import { test, expect } from '@playwright/test';

// All tests seed auth via addInitScript (sets localStorage before Angular bootstraps)
// and use Playwright route interception to mock the preferences API, so these tests
// are independent of the Docker API image version.

const MOCK_PREFS = {
  user_id: 'e2e-test-uuid',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
};

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

test.describe('Settings', () => {
  test('unauthenticated /settings visit redirects to /login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });

  test('avatar dropdown includes a Settings button', async ({ page }) => {
    await page.route('http://localhost:3000/users/me', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // dispatchEvent with bubbles:false opens the dropdown via Angular's (click) binding
    // but prevents the event reaching @HostListener('document:click') which closes it.
    await page.locator('.avatar-btn').dispatchEvent('click', { bubbles: false });

    const panel = page.locator('.dropdown-panel');
    await expect(panel).toBeVisible();
    // Dropdown items have role="menuitem", not role="button"
    await expect(panel.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  });

  test('settings page loads and shows placeholder', async ({ page }) => {
    // Intercept /users/me so the onboardingCompletedGuard resolves
    await page.route('http://localhost:3000/users/me', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
    );

    // Intercept preferences API
    await page.route('http://localhost:3000/preferences/me', async route => {
      await route.fulfill({ status: 200, json: MOCK_PREFS });
    });

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/settings');

    await expect(page.locator('h1')).toHaveText('Settings');
    await expect(page.locator('.placeholder')).toBeVisible();
  });
});
