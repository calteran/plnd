import { test, expect } from '@playwright/test';

// All tests seed auth via addInitScript (sets localStorage before Angular bootstraps)
// and use Playwright route interception to mock the preferences API, so these tests
// are independent of the Docker API image version.

const MOCK_PREFS = {
  user_id: 'e2e-test-uuid',
  theme: 'system',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
};

test.describe('Settings', () => {
  test('unauthenticated /settings visit redirects to /login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });

  test('avatar dropdown includes a Settings button', async ({ page }) => {
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

  test('settings page loads preferences and saves theme change', async ({ page }) => {
    // Intercept preferences API so the test works regardless of the Docker image version.
    await page.route('http://localhost:3000/preferences/me', async route => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({ status: 200, json: MOCK_PREFS });
      } else if (method === 'PATCH') {
        await route.fulfill({ status: 200, json: { ...MOCK_PREFS, theme: 'dark' } });
      } else {
        await route.continue();
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/settings');

    await expect(page.locator('h1')).toHaveText('Settings');

    // Preferences signal is populated from the mocked GET → form appears.
    // Wait for Angular to finish its initial writeValue() pass before interacting —
    // otherwise selectOption() races with Angular's DOM initialization.
    const select = page.locator('select#theme');
    await expect(select).toHaveValue('system', { timeout: 5_000 });

    await select.selectOption('dark');
    await expect(select).toHaveValue('dark');

    // eventCoalescing batches Angular's change detection until rAF, which is
    // slow in headless Chrome. Wait explicitly for the FormControl to turn dirty
    // (Save button becomes enabled) before proceeding.
    const saveBtn = page.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });

    await saveBtn.click();
    await expect(page.locator('.status-success')).toHaveText('Settings saved.', { timeout: 10_000 });
  });
});
