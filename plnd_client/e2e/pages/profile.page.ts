import { Page } from '@playwright/test';

export class ProfilePage {
  constructor(private readonly page: Page) {}

  async goto() { await this.page.goto('/profile'); }

  getHeading() { return this.page.locator('h1'); }
  getEmailRow() { return this.page.locator('.info-row').filter({ hasText: 'Email' }).locator('.info-value'); }
  getMemberSinceRow() { return this.page.locator('.info-row').filter({ hasText: 'Member since' }).locator('.info-value'); }
  getLastLoginRow() { return this.page.locator('.info-row').filter({ hasText: 'Last login' }).locator('.info-value'); }
  getDisplayNameInput() { return this.page.getByLabel('Display name'); }
  getAvatarUrlInput() { return this.page.getByLabel('Avatar URL'); }
  getSaveButton() { return this.page.getByRole('button', { name: 'Save' }); }
  getCancelButton() { return this.page.getByRole('button', { name: 'Cancel' }); }
  getBackButton() { return this.page.getByRole('button', { name: /back/i }); }
  getSuccessMessage() { return this.page.locator('.status-success'); }
  getErrorMessage() { return this.page.locator('.status-error'); }
}
