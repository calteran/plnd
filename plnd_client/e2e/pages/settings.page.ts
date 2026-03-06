import { Page } from '@playwright/test';

export class SettingsPage {
  constructor(private readonly page: Page) {}

  async goto() { await this.page.goto('/settings'); }
  getHeading() { return this.page.locator('h1'); }
  getThemeSelect() { return this.page.locator('select#theme'); }
  getSaveButton() { return this.page.getByRole('button', { name: 'Save' }); }
  getSuccessMessage() { return this.page.locator('.status-success'); }
}
