import { test, expect } from '../fixtures';
import { seedAuth } from '../helpers/auth';
import { seedDietaryRestrictions } from '../helpers/seed-data';

// Per docs/architecture.md §9.7, dietary-restriction CRUD flows through the
// real backend in e2e — no page.route() interceptors. Tests that need a
// pre-existing restriction (edit, delete, list) seed it via the
// seedDietaryRestrictions helper, which posts to /dietary-restrictions before
// the page loads.

const SEED_PEANUTS = { restriction_type: 'allergy', name: 'peanuts' } as const;
const SEED_LACTOSE = { restriction_type: 'intolerance', name: 'lactose', notes: 'mild' } as const;

test.describe('Dietary Restrictions', () => {
  test('unauthenticated /dietary-restrictions visit redirects to /login', async ({ page }) => {
    await page.goto('/dietary-restrictions');
    await expect(page).toHaveURL(/\/login/);
  });

  test('list renders restriction names', async ({ page }) => {
    const { sub } = await seedAuth(page);
    await seedDietaryRestrictions(sub, [SEED_PEANUTS, SEED_LACTOSE]);

    await page.goto('/dietary-restrictions');

    await expect(page.locator('h1')).toHaveText('Dietary Restrictions');
    await expect(page.locator('.restriction-item').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('body')).toContainText('peanuts');
    await expect(page.locator('body')).toContainText('lactose');
    await expect(page.locator('body')).toContainText('mild');
  });

  test('add restriction shows success and new item', async ({ page }) => {
    const { sub } = await seedAuth(page);
    await seedDietaryRestrictions(sub, [SEED_PEANUTS, SEED_LACTOSE]);

    await page.goto('/dietary-restrictions');
    await expect(page.locator('.restriction-item').first()).toBeVisible({ timeout: 5_000 });

    await page.locator('select#restriction-type').selectOption('preference');
    await page.locator('input#name').fill('vegan');
    await page.locator('textarea#notes').fill('plant-based only');

    await page.getByRole('button', { name: 'Add Restriction' }).click();
    await expect(page.locator('.status-success')).toHaveText('Restriction added.', { timeout: 10_000 });
    await expect(page.locator('body')).toContainText('vegan');
    await expect(page.locator('body')).toContainText('plant-based only');
  });

  test('edit notes shows success and updated notes', async ({ page }) => {
    const { sub } = await seedAuth(page);
    // Seed two restrictions; we'll edit the lactose (intolerance) item.
    await seedDietaryRestrictions(sub, [SEED_PEANUTS, SEED_LACTOSE]);

    await page.goto('/dietary-restrictions');
    await expect(page.locator('.restriction-item').first()).toBeVisible({ timeout: 5_000 });

    // Items are grouped by restriction_type in the order
    // [allergy, intolerance, preference, cultural_religious] (see
    // RESTRICTION_TYPES in plnd_client/src/app/core/models/dietary-restriction.ts),
    // so .restriction-item nth(0)=peanuts (allergy), nth(1)=lactose (intolerance).
    const items = page.locator('.restriction-item');
    await items.nth(1).getByRole('button', { name: 'Edit' }).click();

    const editTextarea = page.locator('.edit-textarea');
    await expect(editTextarea).toBeVisible();
    await editTextarea.fill('severe');

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.status-success')).toHaveText('Updated successfully.', { timeout: 10_000 });
    await expect(page.locator('body')).toContainText('severe');
  });

  test('delete restriction removes item from list', async ({ page }) => {
    const { sub } = await seedAuth(page);
    await seedDietaryRestrictions(sub, [SEED_PEANUTS, SEED_LACTOSE]);

    await page.goto('/dietary-restrictions');
    await expect(page.locator('.restriction-item').first()).toBeVisible({ timeout: 5_000 });

    const initialCount = await page.locator('.restriction-item').count();
    expect(initialCount).toBe(2);

    // Delete the first item (peanuts/allergy)
    await page.locator('.restriction-item').first().getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.status-success')).toHaveText('Restriction removed.', { timeout: 10_000 });
    await expect(page.locator('.restriction-item')).toHaveCount(1);
  });
});
