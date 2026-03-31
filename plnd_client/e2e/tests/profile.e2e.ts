import { test, expect, Page } from '@playwright/test';
import { API_BASE, MOCK_USER_ONBOARDED, seedAuth } from '../helpers/auth';
import { ProfilePage } from '../pages/profile.page';

// All tests seed auth via addInitScript (sets localStorage before Angular bootstraps)
// and use Playwright route interception to mock the users API, so these tests
// are independent of the Docker API image version.
//
// Tests that verify form pre-population navigate through /today first so that the
// UserService signal is populated before ProfileComponent initialises.

async function goToProfile(page: Page): Promise<ProfilePage> {
  await page.goto('/today');
  await page.waitForURL(/\/day\//);
  const profile = new ProfilePage(page);
  await profile.goto();
  await expect(profile.getHeading()).toHaveText('My Profile');
  return profile;
}

test.describe('Profile', () => {
  test('unauthenticated /profile visit redirects to /login', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login/);
  });

  test('profile page loads and shows "My Profile" heading', async ({ page }) => {
    await seedAuth(page);
    const profile = new ProfilePage(page);
    await profile.goto();
    await expect(profile.getHeading()).toHaveText('My Profile');
  });

  test('read-only section displays email address, member since, and last login', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    await expect(profile.getEmailRow()).toHaveText(MOCK_USER_ONBOARDED.email);
    // created_at is '2026-01-01T00:00:00Z' — verify the year is rendered
    await expect(profile.getMemberSinceRow()).toContainText('2026');
    // last_login is null — component renders 'Never'
    await expect(profile.getLastLoginRow()).toHaveText('Never');
  });

  test('display name field is pre-populated with the current value', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    await expect(profile.getDisplayNameInput()).toHaveValue(MOCK_USER_ONBOARDED.display_name!);
  });

  test('editing display name and clicking Save shows a success message', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    let patchBody: Record<string, string> | undefined;
    await page.route(`${API_BASE}/users/me`, async (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = JSON.parse(route.request().postData() ?? '{}');
      }
      await route.fulfill({ status: 200, json: MOCK_USER_ONBOARDED });
    });

    await profile.getDisplayNameInput().fill('Updated Name');
    await profile.getSaveButton().click();
    await expect(profile.getSuccessMessage()).toHaveText('Profile updated.', { timeout: 5_000 });
    expect(patchBody).toMatchObject({ display_name: 'Updated Name' });
  });

  test('avatar URL field accepts a valid URL and save succeeds', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    await profile.getAvatarUrlInput().fill('https://example.com/avatar.jpg');
    await profile.getSaveButton().click();
    await expect(profile.getSuccessMessage()).toHaveText('Profile updated.', { timeout: 5_000 });
  });

  test('invalid avatar URL prevents save', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    let patchCalled = false;
    await page.route(`${API_BASE}/users/me`, async (route) => {
      if (route.request().method() === 'PATCH') patchCalled = true;
      await route.fulfill({ status: 200, json: MOCK_USER_ONBOARDED });
    });

    // 'not-a-url' lacks a scheme — browser's native type="url" validation blocks submit
    await profile.getAvatarUrlInput().fill('not-a-url');
    await profile.getSaveButton().click();
    // If native validation fires, ngSubmit never runs and no PATCH is sent
    await expect(profile.getSuccessMessage()).not.toBeVisible();
    expect(patchCalled).toBe(false);
  });

  test('Cancel button discards unsaved changes and restores original values', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    const original = MOCK_USER_ONBOARDED.display_name!;
    await profile.getDisplayNameInput().fill('Temporary Change');
    await expect(profile.getDisplayNameInput()).toHaveValue('Temporary Change');

    await profile.getCancelButton().click();
    await expect(profile.getDisplayNameInput()).toHaveValue(original);
  });

  test('Back button navigates away from the profile page', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    await profile.getBackButton().click();
    await expect(page).toHaveURL(/\/day\//);
  });
});
