import { Page } from '@playwright/test';

export class DayViewPage {
  constructor(private readonly page: Page) {}

  async goto()                   { await this.page.goto('/today'); }
  async gotoDate(date: string)   { await this.page.goto(`/day/${date}`); }
  getHeading()                   { return this.page.locator('.schedule-view'); }

  // Day header
  getDateText()    { return this.page.locator('.date-text'); }
  getPrevButton()  { return this.page.getByRole('button', { name: 'Previous day' }); }
  getNextButton()  { return this.page.getByRole('button', { name: 'Next day' }); }

  // Schedule states
  getScheduleList() { return this.page.locator('.schedule-list'); }
  getSkeletonList() { return this.page.locator('.skeleton-list'); }
  getEmptyState()   { return this.page.locator('.empty-state'); }
  getErrorState()   { return this.page.locator('[role="alert"]'); }
  getRetryButton()  { return this.page.locator('.retry-link'); }

  // Schedule row items
  getMealRows() { return this.page.locator('app-meal-row'); }
  getTaskRows() { return this.page.locator('app-task-row'); }

  /** Open the avatar dropdown then click Sign out. */
  async signOut() {
    await this.page.locator('.avatar-btn').click();
    await this.page.getByRole('menuitem', { name: 'Sign out' }).click();
  }
}
