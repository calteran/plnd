import { Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() { await this.page.goto('/login'); }
  getHeading() { return this.page.locator('h1'); }
  getSignInButton() { return this.page.getByRole('button', { name: 'Sign in with Mock OAuth' }); }
  async clickSignIn() { await this.getSignInButton().click(); }
}
