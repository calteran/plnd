import { Page } from '@playwright/test';

export class DayViewPage {
  constructor(private readonly page: Page) {}

  async goto() { await this.page.goto('/today'); }
  getHeading() { return this.page.locator('.schedule-view'); }

  /** Open the avatar dropdown then click Sign out. */
  async signOut() {
    await this.page.locator('.avatar-btn').click();
    await this.page.getByRole('menuitem', { name: 'Sign out' }).click();
  }
}
