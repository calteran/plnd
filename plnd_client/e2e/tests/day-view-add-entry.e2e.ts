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

  test.describe('agent integration', () => {
    async function openAndFill(page: Page, text: string) {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().fill(text);
      return dayView;
    }

    test('shows loading indicator while agent request is in flight', async ({ page }) => {
      // Delay the agent response so we can observe the loading state
      await page.route(`${API_BASE}/agent/task`, async route => {
        await new Promise(r => setTimeout(r, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ actions_taken: [{ type: 'task_created', task_id: 'e2e-task-1' }], ui_signals: [], confirmation: 'Task added!' }),
        });
      });

      const dayView = await openAndFill(page, 'call mum');
      await dayView.getAddButton().click();
      await expect(dayView.getLoadingIndicator()).toBeVisible();
      await expect(dayView.getAgentConfirmation()).toBeVisible({ timeout: 2_000 });
    });

    test('shows confirmation message after agent responds', async ({ page }) => {
      await page.route(`${API_BASE}/agent/task`, route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ actions_taken: [{ type: 'task_created', task_id: 'e2e-task-2' }], ui_signals: [], confirmation: 'Task scheduled!' }),
        }),
      );

      const dayView = await openAndFill(page, 'call mum');
      await dayView.getAddButton().click();
      await expect(dayView.getAgentConfirmation()).toBeVisible({ timeout: 2_000 });
      await expect(dayView.getAgentConfirmation()).toContainText('Task scheduled!');
    });

    test('shows error message when agent call fails', async ({ page }) => {
      await page.route(`${API_BASE}/agent/task`, route =>
        route.fulfill({ status: 500 }),
      );

      const dayView = await openAndFill(page, 'call mum');
      await dayView.getAddButton().click();
      await expect(dayView.getAgentError()).toBeVisible({ timeout: 2_000 });
      await expect(dayView.getAgentError()).toContainText('Something went wrong');
    });

    test('submitting the form adds the entry to the schedule list', async ({ page }) => {
      const SEED_ITEM = {
        entry_id: 'seed-1',
        task_type: 'custom',
        title: 'Existing task',
        status: 'planned',
        date: '2026-03-28',
        scheduled_start: '2026-03-28T09:00:00Z',
      };
      const NEW_ITEM = {
        entry_id: 'new-entry-1',
        task_type: 'custom',
        title: 'call mum',
        status: 'planned',
        date: '2026-03-28',
        scheduled_start: '2026-03-28T09:01:00Z',
      };

      // Stateful mock: after the agent creates the task the reload returns the updated list.
      let taskCreated = false;
      await page.route(`${API_BASE}/schedule/period**`, route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            entries: taskCreated ? [SEED_ITEM, NEW_ITEM] : [SEED_ITEM],
            carryover: [],
          }),
        }),
      );
      await page.route(`${API_BASE}/agent/task`, route => {
        taskCreated = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            actions_taken: [{ type: 'task', task_id: 'new-entry-1' }],
            ui_signals: [],
            confirmation: 'Task added!',
          }),
        });
      });

      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.openAddEntry();
      await dayView.getEntryInput().fill('call mum');
      await dayView.getAddButton().click();
      await expect(dayView.getScheduleList()).toContainText('call mum', { timeout: 5_000 });
    });
  });

});
