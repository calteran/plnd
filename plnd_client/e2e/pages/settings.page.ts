import { Page } from '@playwright/test';

export class SettingsPage {
  constructor(private readonly page: Page) {}

  async goto() { await this.page.goto('/settings'); }
  getHeading() { return this.page.locator('h1'); }
  getThemeSelect() { return this.page.locator('select#theme'); }
  getWeekStartSelect() { return this.page.locator('select#weekStartDay'); }
  getPlanLengthInput() { return this.page.locator('input#planLengthDays'); }
  getPlanningTriggerInput() { return this.page.locator('input#planningTriggerOffset'); }
  getBackButton() { return this.page.getByRole('button', { name: /back/i }); }
  getSaveButton() { return this.page.getByRole('button', { name: 'Save' }); }
  getSuccessMessage() { return this.page.locator('.status-success'); }
  getErrorMessage() { return this.page.locator('.status-error'); }
}
