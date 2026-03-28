import { test, expect, Page } from '@playwright/test';
import { DayViewPage } from '../pages/day-view.page';

// ── Shared mock fixtures ────────────────────────────────────────────────────

const API_BASE = 'http://localhost:3000';

const MOCK_USER_ONBOARDED = {
  user_id: 'e2e-test-uuid',
  email: 'testuser@mock.plnd',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: true,
};

const MOCK_PREFS = {
  user_id: 'e2e-test-uuid',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  week_start_day: 1,
  planning_trigger_offset: 0,
  default_plan_length_days: 7,
};

// A realistic schedule response: one meal row + one task row.
// Used by tests that mock GET /schedule — requires HTTP implementation in ScheduleService.
const MOCK_SCHEDULE_ITEMS = [
  {
    id: 'm1',
    name: 'Breakfast',
    emoji: '🥑',
    description: 'Avocado toast',
    status: 'planned',
    duringMealTasks: [],
  },
  {
    id: 't1',
    type: 'task',
    label: 'Morning stretch',
    status: 'pending',
  },
];

// ── Auth helper ─────────────────────────────────────────────────────────────

async function seedAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'synthetic.test.token');
  });
  await page.route(`${API_BASE}/users/me`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
  );
  await page.route(`${API_BASE}/preferences/me`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
  );
  await page.route(`${API_BASE}/schedule/plan/status**`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ planned: false }) })
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Day View', () => {

  test('unauthenticated /day/:date visit redirects to /login', async ({ page }) => {
    await page.goto('/day/2026-03-28');
    await expect(page).toHaveURL(/\/login/);
  });

  test.describe('URL routing', () => {
    test('/today redirects to canonical /day/YYYY-MM-DD URL', async ({ page }) => {
      await seedAuth(page);
      await page.goto('/today');
      await expect(page).toHaveURL(/\/day\/\d{4}-\d{2}-\d{2}/);
    });
  });

  test.describe('Day header', () => {
    test('shows the formatted date for the URL date', async ({ page }) => {
      await seedAuth(page);
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      // Saturday, Mar 28 (en-US locale formatting)
      await expect(dayView.getDateText()).toHaveText(/Mar 28/);
    });

    test('shows "Today" badge when viewing today\'s date', async ({ page }) => {
      await seedAuth(page);
      await page.goto('/today');
      await expect(page.locator('.today-badge')).toBeVisible();
    });

    test('next button advances the date in URL and header', async ({ page }) => {
      await seedAuth(page);
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await dayView.getNextButton().click();
      await expect(page).toHaveURL('/day/2026-03-29');
      await expect(dayView.getDateText()).toHaveText(/Mar 29/);
    });

    test('prev button moves the date back in URL and header', async ({ page }) => {
      await seedAuth(page);
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await dayView.getPrevButton().click();
      await expect(page).toHaveURL('/day/2026-03-27');
      await expect(dayView.getDateText()).toHaveText(/Mar 27/);
    });
  });

  test.describe('Loading state', () => {
    test('shows loading skeleton while schedule is fetching', async ({ page }) => {
      await seedAuth(page);
      const dayView = new DayViewPage(page);
      // Navigate and immediately assert — skeleton is visible during the loading window.
      const gotoPromise = dayView.gotoDate('2026-03-28');
      await expect(dayView.getSkeletonList()).toBeVisible({ timeout: 2_000 });
      await gotoPromise;
    });
  });

  test.describe('Schedule display', () => {
    test('renders meal rows and task rows from the schedule', async ({ page }) => {
      await seedAuth(page);
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');

      // Wait for schedule list (mock data loads after 300 ms in current implementation)
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await expect(dayView.getMealRows().first()).toBeVisible();
      await expect(dayView.getTaskRows().first()).toBeVisible();
    });

    test('meal row shows emoji and name', async ({ page }) => {
      await seedAuth(page);
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      // mock data always includes Breakfast with 🥑
      await expect(dayView.getMealRows().first()).toContainText('Breakfast');
      await expect(dayView.getMealRows().first()).toContainText('🥑');
    });

    test('task row shows task label', async ({ page }) => {
      await seedAuth(page);
      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      // mock data always includes '5-min stretch' task
      await expect(dayView.getTaskRows().first()).toContainText('stretch');
    });
  });

  // ── The following tests require HTTP implementation in ScheduleService ──
  // ScheduleService.loadDay() currently uses setTimeout + mock data instead of
  // HttpClient. Once replaced with GET /schedule?date=<date>, these tests will pass.

  // ── Tests below are marked test.fail() because ScheduleService.loadDay() currently
  // ── uses setTimeout + mock data instead of HttpClient. Once replaced with
  // ── GET /schedule?date=<date>, remove the test.fail() call from each test.

  test.describe('Empty state', () => {
    test('shows "Nothing planned yet" when the schedule is empty', async ({ page }) => {
      test.fail(); // TODO: remove when ScheduleService uses HttpClient
      await seedAuth(page);
      await page.route(`${API_BASE}/schedule*`, route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      );

      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');

      await expect(dayView.getEmptyState()).toBeVisible({ timeout: 5_000 });
      await expect(dayView.getEmptyState()).toContainText('Nothing planned yet');
    });
  });

  test.describe('Error state', () => {
    test('shows error message with retry button when the schedule API fails', async ({ page }) => {
      test.fail(); // TODO: remove when ScheduleService uses HttpClient
      await seedAuth(page);
      await page.route(`${API_BASE}/schedule*`, route =>
        route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) })
      );

      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');

      await expect(dayView.getErrorState()).toBeVisible({ timeout: 5_000 });
      await expect(dayView.getRetryButton()).toBeVisible();
    });

    test('retry button re-fetches the schedule', async ({ page }) => {
      test.fail(); // TODO: remove when ScheduleService uses HttpClient
      await seedAuth(page);

      let callCount = 0;
      await page.route(`${API_BASE}/schedule*`, route => {
        callCount++;
        if (callCount === 1) {
          return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fail' }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SCHEDULE_ITEMS) });
      });

      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getErrorState()).toBeVisible({ timeout: 5_000 });

      await dayView.getRetryButton().click();
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 5_000 });
    });
  });

});
