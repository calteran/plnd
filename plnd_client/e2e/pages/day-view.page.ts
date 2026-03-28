import { Page, Locator } from '@playwright/test';

export class DayViewPage {
  constructor(private readonly page: Page) {}

  async goto() { await this.page.goto('/today'); }
  async gotoDate(date: string) { await this.page.goto(`/day/${date}`); }
  getHeading() { return this.page.locator('.schedule-view'); }

  // Day header
  getDateText() { return this.page.locator('.date-text'); }
  getPrevButton() { return this.page.getByRole('button', { name: 'Previous day' }); }
  getNextButton() { return this.page.getByRole('button', { name: 'Next day' }); }
  getTodayBadge() { return this.page.locator('.today-badge'); }

  // Schedule states
  getScheduleList() { return this.page.locator('.schedule-list'); }
  getSkeletonList() { return this.page.getByLabel('Loading schedule'); }
  getEmptyState() { return this.page.locator('.empty-state'); }
  getErrorState() { return this.page.getByRole('alert'); }
  getRetryButton() { return this.page.getByRole('button', { name: /retry/i }); }

  // Schedule row items
  getMealRows() { return this.page.locator('app-meal-row'); }
  getTaskRows() { return this.page.locator('.schedule-list > app-task-row'); }
  getTaskRowInner(row: Locator) { return row.locator('.task-row'); }
  getTaskRowCheckbox(row: Locator) { return row.getByRole('checkbox'); }
  getTaskRowLabel(row: Locator) { return row.locator('.label'); }

  // Add-entry form
  getAddRow() { return this.page.getByRole('button', { name: 'Open entry form' }); }
  getEntryInput() { return this.page.getByLabel('Add something to your day'); }
  getMorphExercise() { return this.page.locator('.morph-form--exercise'); }
  getMorphAppointment() { return this.page.locator('.morph-form--appointment'); }
  getAddButton() { return this.page.getByRole('button', { name: 'Add', exact: true }); }
  getCancelButton() { return this.page.getByRole('button', { name: 'Cancel', exact: true }); }
  getParseHint() { return this.page.locator('.parse-hint'); }

  /** Click "Add something…" and wait for the text input to appear. */
  async openAddEntry() {
    await this.getAddRow().click();
    await this.getEntryInput().waitFor({ state: 'visible' });
  }

  /** Open the avatar dropdown then click Sign out. */
  async signOut() {
    await this.page.locator('.avatar-btn').click();
    await this.page.getByRole('menuitem', { name: 'Sign out' }).click();
  }
}
