import { Page } from '@playwright/test';

export class DietaryRestrictionsPage {
  constructor(private readonly page: Page) {}

  async goto() { await this.page.goto('/dietary-restrictions'); }
  getHeading() { return this.page.locator('h1'); }
  getAddNameInput() { return this.page.locator('input#name'); }
  getAddTypeSelect() { return this.page.locator('select#restriction-type'); }
  getAddNotesTextarea() { return this.page.locator('textarea#notes'); }
  getAddButton() { return this.page.getByRole('button', { name: 'Add Restriction' }); }
  getRestrictionItems() { return this.page.locator('.restriction-item'); }
  getSuccessMessage() { return this.page.locator('.status-success'); }
  getErrorMessage() { return this.page.locator('.status-error'); }
}
