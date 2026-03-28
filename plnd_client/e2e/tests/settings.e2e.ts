import { test, expect } from '@playwright/test';
import { seedAuth } from '../helpers/auth';

// All tests seed auth via addInitScript (sets localStorage before Angular bootstraps)
// and use Playwright route interception to mock the preferences API, so these tests
// are independent of the Docker API image version.

test.describe('Settings', () => {
  test('unauthenticated /settings visit redirects to /login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/);
  });

  test('avatar dropdown includes a Settings button', async ({ page }) => {
    await seedAuth(page);
    await page.goto('/today');
    await expect(page).toHaveURL(/\/day\//);

    // dispatchEvent with bubbles:false opens the dropdown via Angular's (click) binding
    // but prevents the event reaching @HostListener('document:click') which closes it.
    await page.locator('.avatar-btn').dispatchEvent('click', { bubbles: false });

    const panel = page.locator('.dropdown-panel');
    await expect(panel).toBeVisible();
    // Dropdown items have role="menuitem", not role="button"
    await expect(panel.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  });

  test('settings page loads and shows planning form controls', async ({ page }) => {
    await seedAuth(page);
    await page.goto('/settings');

    await expect(page.locator('h1')).toHaveText('Settings');
    await expect(page.locator('#weekStartDay')).toBeVisible();
  });
});
