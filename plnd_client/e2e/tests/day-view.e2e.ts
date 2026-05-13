import { test, expect } from '@playwright/test';
import { DayViewPage } from '../pages/day-view.page';
import { API_BASE, seedAuth } from '../helpers/auth';
import { seedScheduleEntries } from '../helpers/seed-data';

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Day View', () => {

  test('unauthenticated /day/:date visit redirects to /login', async ({ page }) => {
    await page.goto('/day/2026-03-28');
    await expect(page).toHaveURL(/\/login/);
  });

  test.describe('authenticated', () => {
    test.beforeEach(async ({ page }) => {
      const { sub } = await seedAuth(page);
      // Seed entries that the Schedule-display tests assert against. Tests
      // that need an empty/error/loading schedule still install their own
      // /schedule/period mocks to override these.
      await seedScheduleEntries(sub, {
        plan_start: '2026-03-23',
        plan_end: '2026-03-29',
        entries: [
          { date: '2026-03-28', after_anchor: 'breakfast', scheduled_start: '08:00:00', status: 'completed' },
        ],
        placed_tasks: [
          { date: '2026-03-28', task_type: 'general', title: 'Morning stretch', scheduled_start: '07:00:00', status: 'completed' },
        ],
      });
    });

    test.describe('URL routing', () => {
      test('/today redirects to canonical /day/YYYY-MM-DD URL', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.goto();
        await expect(page).toHaveURL(/\/day\/\d{4}-\d{2}-\d{2}/);
      });
    });

    test.describe('Day header', () => {
      test('shows the formatted date for the URL date', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');
        // Saturday, Mar 28 (en-US locale formatting)
        await expect(dayView.getDateText()).toHaveText(/Mar 28/);
      });

      test('shows "Today" badge when viewing today\'s date', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.goto();
        await expect(dayView.getTodayBadge()).toBeVisible();
      });

      test('next button advances the date in URL and header', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');
        await dayView.getNextButton().click();
        await expect(page).toHaveURL('/day/2026-03-29');
        await expect(dayView.getDateText()).toHaveText(/Mar 29/);
      });

      test('prev button moves the date back in URL and header', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');
        await dayView.getPrevButton().click();
        await expect(page).toHaveURL('/day/2026-03-27');
        await expect(dayView.getDateText()).toHaveText(/Mar 27/);
      });
    });

    test.describe('Loading state', () => {
      test('shows loading skeleton while schedule is fetching', async ({ page }) => {
        // Hold the schedule response so we can observe the skeleton while the
        // request is in flight. ScheduleService now uses HttpClient (not setTimeout),
        // so we control timing via the route handler rather than page.clock.
        let releaseResponse!: () => void;
        const hold = new Promise<void>(r => { releaseResponse = r; });
        await page.route(`${API_BASE}/schedule/period**`, async route => {
          await hold;
          await route.fulfill({ status: 200, json: { entries: [], carryover: [] } });
        });

        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');
        await expect(dayView.getSkeletonList()).toBeVisible({ timeout: 2_000 });
        releaseResponse();
        await expect(dayView.getSkeletonList()).not.toBeVisible({ timeout: 2_000 });
      });
    });

    test.describe('Schedule display', () => {
      test('renders meal rows and task rows from the schedule', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');

        // Wait for schedule list (mock data loads after 300 ms in current implementation)
        await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
        await expect(dayView.getMealRows().first()).toBeVisible();
        await expect(dayView.getTaskRows().first()).toBeVisible();
      });

      test('meal row shows emoji and name', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');
        await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

        // seedAuth mock returns a breakfast meal; MEAL_SLOTS maps 'breakfast' → 🥣
        await expect(dayView.getMealRows().first()).toContainText('Breakfast');
        await expect(dayView.getMealRows().first()).toContainText('🥣');
      });

      test('task row shows task label', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');
        await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

        // seedAuth mock returns a 'Morning stretch' task
        await expect(dayView.getTaskRows().first()).toContainText('stretch');
      });
    });

    test.describe('Empty state', () => {
      test('shows "Nothing planned yet" when the schedule is empty', async ({ page }) => {
        await page.route(`${API_BASE}/schedule/period**`, route =>
          route.fulfill({ status: 200, json: { entries: [], carryover: [] } })
        );

        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');

        await expect(dayView.getEmptyState()).toBeVisible({ timeout: 5_000 });
        await expect(dayView.getEmptyState()).toContainText('Nothing planned yet');
      });
    });

    test.describe('Error state', () => {
      test('shows error message with retry button when the schedule API fails', async ({ page }) => {
        await page.route(`${API_BASE}/schedule/period**`, route =>
          route.fulfill({ status: 500, json: { error: 'Internal Server Error' } })
        );

        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');

        await expect(dayView.getErrorState()).toBeVisible({ timeout: 5_000 });
        await expect(dayView.getRetryButton()).toBeVisible();
      });

      test('retry button re-fetches the schedule', async ({ page }) => {
        let callCount = 0;
        await page.route(`${API_BASE}/schedule/period**`, async route => {
          callCount++;
          if (callCount === 1) {
            await route.fulfill({ status: 500, json: { error: 'fail' } });
          } else {
            await route.fallback();
          }
        });

        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');
        await expect(dayView.getErrorState()).toBeVisible({ timeout: 5_000 });

        await dayView.getRetryButton().click();
        await expect(dayView.getScheduleList()).toBeVisible({ timeout: 5_000 });
      });
    });

  });

});
