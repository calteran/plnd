import { test, expect } from '../fixtures';
import { DayViewPage } from '../pages/day-view.page';
import { API_BASE, seedAuth, generateTestSub, injectAuthToken, seedTestState } from '../helpers/auth';
import { seedMealAnchor, seedScheduleEntries } from '../helpers/seed-data';

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Day View', () => {

  test('unauthenticated /day/:date visit redirects to /login', async ({ page }) => {
    await page.goto('/day/2026-03-28');
    await expect(page).toHaveURL(/\/login/);
  });

  test.describe('authenticated', () => {
    test.beforeEach(async ({ page }) => {
      const { sub } = await seedAuth(page);
      // Seed entries for the planning week containing 2026-03-28. Tests that
      // exercise empty/loading/error states navigate to dates outside this
      // window or install their own /schedule/period mock to override.
      await seedMealAnchor(sub, { date: '2026-03-28', name: 'breakfast', preferred_time: '08:00' });
      await seedScheduleEntries(sub, {
        plan_start: '2026-03-23',
        plan_end: '2026-03-29',
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
        // Reason: the real backend responds in milliseconds, faster than Playwright
        // can reliably observe the skeleton; we must hold the request open ourselves.
        let releaseResponse!: () => void;
        const hold = new Promise<void>(r => { releaseResponse = r; });
        await page.route(`${API_BASE}/schedule/period**`, async route => {
          await hold;
          await route.fulfill({ status: 200, json: { entries: [], carryover: [] } });
        });

        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');
        await expect(dayView.getSkeletonList()).toBeVisible();
        releaseResponse();
        await expect(dayView.getSkeletonList()).not.toBeVisible({ timeout: 2_000 });
      });
    });

    test.describe('Schedule display', () => {
      test('renders meal rows and task rows from the schedule', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');

        await expect(dayView.getScheduleList()).toBeVisible();
        await expect(dayView.getMealRows().first()).toBeVisible();
        await expect(dayView.getTaskRows().first()).toBeVisible();
      });

      test('meal row shows emoji and name', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');
        await expect(dayView.getScheduleList()).toBeVisible();

        // Seeded breakfast meal anchor; MEAL_SLOTS maps 'breakfast' → 🥣
        await expect(dayView.getMealRows().first()).toContainText('Breakfast');
        await expect(dayView.getMealRows().first()).toContainText('🥣');
      });

      test('task row shows task label', async ({ page }) => {
        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');
        await expect(dayView.getScheduleList()).toBeVisible();

        // Seeded 'Morning stretch' task placed for 2026-03-28
        await expect(dayView.getTaskRows().first()).toContainText('stretch');
      });
    });

    test.describe('Error state', () => {
      test('shows error message with retry button when the schedule API fails', async ({ page }) => {
        // Reason: the real backend has no path that reliably returns 500 for an
        // authenticated /schedule/period request without breaking other tests
        // (e.g. by killing the DB); this test asserts the frontend's failure UI.
        await page.route(`${API_BASE}/schedule/period**`, route =>
          route.fulfill({ status: 500, json: { error: 'Internal Server Error' } })
        );

        const dayView = new DayViewPage(page);
        await dayView.gotoDate('2026-03-28');

        await expect(dayView.getErrorState()).toBeVisible();
        await expect(dayView.getRetryButton()).toBeVisible();
      });

      test('retry button re-fetches the schedule', async ({ page }) => {
        // Reason: forces the first /schedule/period call to fail (500) so the
        // retry button can be exercised; the real backend cannot be coerced into
        // a one-shot 500-then-200 sequence. The second call falls through to the
        // real backend, which serves the entries seeded in beforeEach.
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
        await expect(dayView.getErrorState()).toBeVisible();

        await dayView.getRetryButton().click();
        await expect(dayView.getScheduleList()).toBeVisible();
      });
    });

  });

  // Empty state requires a user with NO day types: a user with a day type will
  // always materialise meal anchors for any date, so the schedule is never empty.
  test.describe('Empty state', () => {
    test.beforeEach(async ({ page }) => {
      const sub = generateTestSub();
      await injectAuthToken(page, sub);
      // Onboarded (so /day/:date loads), but no default day type so materialization
      // returns zero anchors for any date — the truly-empty schedule state.
      await seedTestState(sub, { preset: 'onboarded', default_day_type: false });
    });

    test('shows "Nothing planned yet" when the schedule is empty', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-04-15');

      await expect(dayView.getEmptyState()).toBeVisible();
      await expect(dayView.getEmptyState()).toContainText('Nothing planned yet');
    });
  });

});
