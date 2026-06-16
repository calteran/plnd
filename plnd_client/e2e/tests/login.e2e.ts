import { test, expect } from '../fixtures';
import { LoginPage } from '../pages/login.page';

test.describe('Login page', () => {
  test('renders heading and sign-in button', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await expect(login.getHeading()).toHaveText('Welcome to PLND');
    await expect(login.getSignInButton()).toBeVisible();
  });

  test('unauthenticated root visit redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
