import { Page } from '@playwright/test';

export class DashboardPage {
  constructor(private readonly page: Page) {}

  async goto() { await this.page.goto('/dashboard'); }
  getHeading() { return this.page.locator('h2'); }
  getSignOutButton() { return this.page.getByRole('button', { name: 'Sign out' }); }
}
