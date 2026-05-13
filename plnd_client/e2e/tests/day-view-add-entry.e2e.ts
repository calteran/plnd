import { test, expect, Page } from '@playwright/test';
import { DayViewPage } from '../pages/day-view.page';
import { API_BASE, seedAuth } from '../helpers/auth';
import { seedScheduleEntries } from '../helpers/seed-data';

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Day View — Add Entry', () => {

  let testSub: string;

  test.beforeEach(async ({ page }) => {
    const { sub } = await seedAuth(page);
    testSub = sub;
    // Seed an existing task so the schedule list (which hosts the "Add
    // something…" trigger row) renders against the real backend. Tests that
    // exercise the add flow then mock /agent/task to control the LLM response.
    await seedScheduleEntries(sub, {
      plan_start: '2026-03-23',
      plan_end: '2026-03-29',
      placed_tasks: [
        { date: '2026-03-28', task_type: 'general', title: 'Existing task', scheduled_start: '09:00:00' },
      ],
    });
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
      // Reason: /agent/task is an LLM endpoint — mocking is permitted by §9.7
      // and required here so we can hold the response open long enough to
      // observe the loading indicator.
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
      // Reason: /agent/task is an LLM endpoint — §9.7 permits mocking so the
      // test can assert on a deterministic confirmation string.
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
      // Reason: /agent/task is an LLM endpoint — §9.7 permits mocking; this
      // test exercises the frontend's failure-path UI which the real backend
      // would not reliably trigger.
      await page.route(`${API_BASE}/agent/task`, route =>
        route.fulfill({ status: 500 }),
      );

      const dayView = await openAndFill(page, 'call mum');
      await dayView.getAddButton().click();
      await expect(dayView.getAgentError()).toBeVisible({ timeout: 2_000 });
      await expect(dayView.getAgentError()).toContainText('Something went wrong');
    });

    test('submitting the form adds the entry to the schedule list', async ({ page }) => {
      // Reason: /agent/task is an LLM endpoint — §9.7 permits mocking. The
      // mocked agent simulates its real side-effect (creating a schedule
      // entry) by re-seeding the schedule via the real backend before
      // returning success. The day-view then reloads /schedule/period from
      // the real backend and sees the new entry.
      await page.route(`${API_BASE}/agent/task`, async route => {
        await seedScheduleEntries(testSub, {
          plan_start: '2026-03-23',
          plan_end: '2026-03-29',
          placed_tasks: [
            { date: '2026-03-28', task_type: 'general', title: 'Existing task', scheduled_start: '09:00:00' },
            { date: '2026-03-28', task_type: 'general', title: 'call mum',      scheduled_start: '09:01:00' },
          ],
        });
        await route.fulfill({
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
