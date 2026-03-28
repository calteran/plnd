import { test, expect, Page } from '@playwright/test';
import { DayViewPage } from '../pages/day-view.page';
import { API_BASE, seedAuth } from '../helpers/auth';

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Day View — Add Entry', () => {

  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
  });

  test.describe('open / close', () => {
    test('"Add something…" row is visible in the schedule list', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await expect(dayView.getAddRow()).toBeVisible();
    });

    test('clicking "Add something…" opens the entry input', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await expect(dayView.getEntryInput()).toBeVisible();
      // "Add something…" trigger row should no longer be visible
      await expect(dayView.getAddRow()).not.toBeVisible();
    });

    test('Cancel button closes the form and "Add something…" row reappears', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().fill('some text');
      await dayView.getCancelButton().click();
      await expect(dayView.getEntryInput()).not.toBeVisible();
      await expect(dayView.getAddRow()).toBeVisible();
    });

    test('Escape key closes the form', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().press('Escape');
      await expect(dayView.getEntryInput()).not.toBeVisible();
      await expect(dayView.getAddRow()).toBeVisible();
    });

    test('Add button is disabled when input is empty', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await expect(dayView.getAddButton()).toBeDisabled();
    });
  });

  test.describe('smart type detection', () => {
    async function openAndType(page: Page, text: string) {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().fill(text);
      return dayView;
    }

    test('exercise keyword shows duration field', async ({ page }) => {
      const dayView = await openAndType(page, 'yoga for a bit');
      await expect(dayView.getMorphExercise()).toBeVisible();
      await expect(dayView.getMorphAppointment()).not.toBeVisible();
      await expect(dayView.getMorphExercise().getByLabel('Duration in minutes')).toBeVisible();
    });

    test('time pattern shows appointment fields (time picker + location)', async ({ page }) => {
      const dayView = await openAndType(page, 'dentist 2pm');
      await expect(dayView.getMorphAppointment()).toBeVisible();
      await expect(dayView.getMorphExercise()).not.toBeVisible();
      await expect(dayView.getMorphAppointment().getByLabel('Appointment time')).toBeVisible();
      await expect(dayView.getMorphAppointment().getByLabel('Location')).toBeVisible();
    });

    test('generic text shows no morph fields (task default)', async ({ page }) => {
      const dayView = await openAndType(page, 'call mum');
      await expect(dayView.getMorphExercise()).not.toBeVisible();
      await expect(dayView.getMorphAppointment()).not.toBeVisible();
    });
  });

  test.describe('deferred features', () => {
    test('parse hint updates based on detected type', async ({ page }) => {
      // TODO: remove test.fail() when parseHint() is implemented (LLM integration, Phase 3)
      test.fail();
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().fill('yoga');
      await expect(dayView.getParseHint()).toBeVisible();
      await expect(dayView.getParseHint()).toContainText(/exercise/i);
    });

    test('submitting the form adds the entry to the schedule list', async ({ page }) => {
      // TODO: remove test.fail() when DayViewComponent.onItemAdded() is implemented
      test.fail();
      const MOCK_CREATED_ENTRY = {
        id: 'new-entry-1',
        type: 'task',
        label: 'call mum',
        status: 'pending',
      };
      await page.route(`${API_BASE}/schedule**`, route => {
        if (route.request().method() === 'POST') {
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_CREATED_ENTRY),
          });
        }
        return route.continue();
      });
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().fill('call mum');
      await dayView.getAddButton().click();
      await expect(dayView.getScheduleList()).toContainText('call mum');
    });
  });

});
