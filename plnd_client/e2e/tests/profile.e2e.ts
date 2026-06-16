import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { seedAuth } from '../helpers/auth';
import { ProfilePage } from '../pages/profile.page';

// Per docs/architecture.md §9.7, all user-data flows hit the real backend in
// e2e — there are no page.route() interceptors here. Each test gets its own
// freshly-minted user via seedAuth (preset='onboarded'), which sets
// display_name='Test User' on the real DB row. The profile reads/writes
// exercise GET /users/me and PATCH /users/me end-to-end.
//
// Tests that verify form pre-population navigate through /today first so that
// the UserService signal is populated before ProfileComponent initialises.

const SEEDED_DISPLAY_NAME = 'Test User'; // matches preset='onboarded' in plnd_api/src/routes/test_seed.rs

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
    const { sub } = await seedAuth(page);
    const profile = await goToProfile(page);

    // mock-oauth-server users get an email of `<sub>@mock.plnd` (see
    // plnd_api/src/routes/auth.rs ~L62). The sub returned by seedAuth is the
    // OIDC subject; since /auth/token finds-or-creates by sub, that's also the
    // email's local-part.
    await expect(profile.getEmailRow()).toHaveText(`${sub}@mock.plnd`);

    // Member since reflects the row's created_at (today, in the test's locale).
    const today = new Date();
    await expect(profile.getMemberSinceRow()).toContainText(String(today.getFullYear()));

    // For freshly-created users, the `find_by_provider`/`find_by_email` paths
    // in /auth/token don't fire on creation, so last_login stays null and the
    // component renders 'Never'. The "formatted date" branch is exercised
    // implicitly by every subsequent token exchange in the production flow
    // and by component-level unit tests.
    await expect(profile.getLastLoginRow()).toHaveText('Never');
  });

  test('display name field is pre-populated with the current value', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    await expect(profile.getDisplayNameInput()).toHaveValue(SEEDED_DISPLAY_NAME);
  });

  test('editing display name and clicking Save shows a success message', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    await profile.getDisplayNameInput().fill('Updated Name');
    await profile.getSaveButton().click();
    await expect(profile.getSuccessMessage()).toHaveText('Profile updated.', { timeout: 5_000 });
    // Real backend echoes the patched value back; the form should now hold it.
    await expect(profile.getDisplayNameInput()).toHaveValue('Updated Name');
  });

  test('avatar URL field accepts a valid URL and save succeeds', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    await profile.getAvatarUrlInput().fill('https://example.com/avatar.jpg');
    await profile.getSaveButton().click();
    await expect(profile.getSuccessMessage()).toHaveText('Profile updated.', { timeout: 5_000 });
    await expect(profile.getAvatarUrlInput()).toHaveValue('https://example.com/avatar.jpg');
  });

  test('invalid avatar URL prevents save', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    // 'not-a-url' has no dot, so it fails the bare-domain heuristic — Angular's pattern
    // validator marks the form invalid, disabling the Save button. No PATCH is issued
    // because the button is disabled.
    await profile.getAvatarUrlInput().fill('not-a-url');
    await expect(profile.getSaveButton()).toBeDisabled();
    await expect(profile.getSuccessMessage()).not.toBeVisible();
  });

  test('Cancel button discards unsaved changes and restores original values', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    await profile.getDisplayNameInput().fill('Temporary Change');
    await expect(profile.getDisplayNameInput()).toHaveValue('Temporary Change');

    await profile.getCancelButton().click();
    await expect(profile.getDisplayNameInput()).toHaveValue(SEEDED_DISPLAY_NAME);
  });

  test('Back button navigates away from the profile page', async ({ page }) => {
    await seedAuth(page);
    const profile = await goToProfile(page);

    await profile.getBackButton().click();
    await expect(page).toHaveURL(/\/day\//);
  });
});
