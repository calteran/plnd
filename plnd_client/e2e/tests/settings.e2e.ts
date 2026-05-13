import { test, expect } from '@playwright/test';
import { seedAuth } from '../helpers/auth';
import { SettingsPage } from '../pages/settings.page';

// Per docs/architecture.md §9.7, all preferences flow through the real
// backend in e2e — no page.route() interceptors. Each test gets a fresh user
// via seedAuth, and the schema defaults (week_start_day=1, planning_trigger_offset=0,
// default_plan_length_days=7) come from migration 0015_planning_preferences.sql.
// PATCH /preferences/me is exercised end-to-end.

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

  test('change "Week starts on" and save shows success message and persists value', async ({ page }) => {
    await seedAuth(page);

    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.getWeekStartSelect()).toBeVisible({ timeout: 5_000 });

    await settings.getWeekStartSelect().selectOption({ label: 'Sunday' });
    await settings.getSaveButton().click();
    await expect(settings.getSuccessMessage()).toHaveText('Settings saved.', { timeout: 10_000 });

    // Round-trip: the real backend echoed week_start_day=0 (Sunday) and the
    // form re-binds to the persisted value.
    const selectedLabel = await settings.getWeekStartSelect().evaluate(
      (el: HTMLSelectElement) => el.options[el.selectedIndex]?.text ?? ''
    );
    expect(selectedLabel).toBe('Sunday');
  });

  test('change "Plan horizon length" and save shows success message', async ({ page }) => {
    await seedAuth(page);

    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.getPlanLengthInput()).toBeVisible({ timeout: 5_000 });

    await settings.getPlanLengthInput().fill('14');
    await settings.getSaveButton().click();

    await expect(settings.getSuccessMessage()).toHaveText('Settings saved.', { timeout: 10_000 });
    await expect(settings.getPlanLengthInput()).toHaveValue('14');
  });

  test('change "Planning reminder" and save shows success message', async ({ page }) => {
    await seedAuth(page);

    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.getPlanningTriggerInput()).toBeVisible({ timeout: 5_000 });

    await settings.getPlanningTriggerInput().fill('-3');
    await settings.getSaveButton().click();

    await expect(settings.getSuccessMessage()).toHaveText('Settings saved.', { timeout: 10_000 });
    await expect(settings.getPlanningTriggerInput()).toHaveValue('-3');
  });

  test('saving with invalid plan horizon (0) shows a validation error without calling the API', async ({ page }) => {
    await seedAuth(page);

    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.getPlanLengthInput()).toBeVisible({ timeout: 5_000 });

    await settings.getPlanLengthInput().fill('0');
    await settings.getSaveButton().click();

    // Client-side validation surfaces the error; the success message must not appear.
    await expect(settings.getErrorMessage()).toBeVisible({ timeout: 5_000 });
    await expect(settings.getSuccessMessage()).not.toBeVisible();
  });

  test('saved settings persist after navigating away and back', async ({ page }) => {
    await seedAuth(page);

    const settings = new SettingsPage(page);
    await settings.goto();
    await expect(settings.getWeekStartSelect()).toBeVisible({ timeout: 5_000 });

    // Change to Sunday and save
    await settings.getWeekStartSelect().selectOption({ label: 'Sunday' });
    await settings.getSaveButton().click();
    await expect(settings.getSuccessMessage()).toHaveText('Settings saved.', { timeout: 10_000 });

    // Navigate away via the Back button — Angular router navigation keeps service state alive
    await settings.getBackButton().click();
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
