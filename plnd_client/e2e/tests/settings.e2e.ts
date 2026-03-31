import { test, expect } from '@playwright/test';
import { API_BASE, MOCK_PREFS, seedAuth } from '../helpers/auth';
import { SettingsPage } from '../pages/settings.page';

// All tests seed auth via addInitScript (sets localStorage before Angular bootstraps)
// and use Playwright route interception to mock the preferences API, so these tests
// are independent of the Docker API image version.

const PREFS_URL = `${API_BASE}/preferences/me`;

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

  test('change "Week starts on" and save shows success message and sends correct payload', async ({ page }) => {
    await seedAuth(page);

    let capturedBody: Record<string, unknown> | null = null;
    await page.route(PREFS_URL, async route => {
      if (route.request().method() === 'PATCH') {
        capturedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ status: 200, json: { ...MOCK_PREFS, week_start_day: 0 } });
      } else {
        await route.fallback();
      }
    });

    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.getWeekStartSelect()).toBeVisible({ timeout: 5_000 });

    await settings.getWeekStartSelect().selectOption({ label: 'Sunday' });
    await settings.getSaveButton().click();

    await expect(settings.getSuccessMessage()).toHaveText('Settings saved.', { timeout: 10_000 });
    expect(capturedBody).toMatchObject({ week_start_day: 0 });
  });

  test('change "Plan horizon length" and save shows success message', async ({ page }) => {
    await seedAuth(page);

    await page.route(PREFS_URL, async route => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 200, json: { ...MOCK_PREFS, default_plan_length_days: 14 } });
      } else {
        await route.fallback();
      }
    });

    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.getPlanLengthInput()).toBeVisible({ timeout: 5_000 });

    await settings.getPlanLengthInput().fill('14');
    await settings.getSaveButton().click();

    await expect(settings.getSuccessMessage()).toHaveText('Settings saved.', { timeout: 10_000 });
  });

  test('change "Planning reminder" and save shows success message', async ({ page }) => {
    await seedAuth(page);

    await page.route(PREFS_URL, async route => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 200, json: { ...MOCK_PREFS, planning_trigger_offset: -3 } });
      } else {
        await route.fallback();
      }
    });

    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.getPlanningTriggerInput()).toBeVisible({ timeout: 5_000 });

    await settings.getPlanningTriggerInput().fill('-3');
    await settings.getSaveButton().click();

    await expect(settings.getSuccessMessage()).toHaveText('Settings saved.', { timeout: 10_000 });
  });

  test('saving with invalid plan horizon (0) shows a validation error without calling the API', async ({ page }) => {
    await seedAuth(page);

    let patchCalled = false;
    await page.route(PREFS_URL, async route => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
        await route.fulfill({ status: 200, json: MOCK_PREFS });
      } else {
        await route.fallback();
      }
    });

    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.getPlanLengthInput()).toBeVisible({ timeout: 5_000 });

    await settings.getPlanLengthInput().fill('0');
    await settings.getSaveButton().click();

    await expect(settings.getErrorMessage()).toBeVisible({ timeout: 5_000 });
    expect(patchCalled).toBe(false);
  });

  test('saved settings persist after navigating away and back', async ({ page }) => {
    await seedAuth(page);

    // Intercept PATCH; GET falls through to seedAuth's handler (MOCK_PREFS week_start_day: 1)
    await page.route(PREFS_URL, async route => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 200, json: { ...MOCK_PREFS, week_start_day: 0 } });
      } else {
        await route.fallback();
      }
    });

    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.getWeekStartSelect()).toBeVisible({ timeout: 5_000 });

    // Change to Sunday and save
    await settings.getWeekStartSelect().selectOption({ label: 'Sunday' });
    await settings.getSaveButton().click();
    await expect(settings.getSuccessMessage()).toHaveText('Settings saved.', { timeout: 10_000 });

    // Navigate away via the Back button — Angular router navigation keeps service state alive
    await page.getByRole('button', { name: /back/i }).click();
    await expect(page).toHaveURL(/\/day\//);

    // Navigate back to settings via the avatar dropdown (router-link navigation, not a page reload)
    await page.locator('.avatar-btn').dispatchEvent('click', { bubbles: false });
    const panel = page.locator('.dropdown-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);

    await expect(settings.getWeekStartSelect()).toBeVisible({ timeout: 5_000 });

    // The form should reflect the saved value (Sunday).
    // Angular [ngValue] uses an internal key format for the option value attribute,
    // so we evaluate the selectedIndex label rather than relying on toHaveValue.
    const selectedLabel = await settings.getWeekStartSelect().evaluate(
      (el: HTMLSelectElement) => el.options[el.selectedIndex]?.text ?? ''
    );
    expect(selectedLabel).toBe('Sunday');
  });
});
