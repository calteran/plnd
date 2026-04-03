import { Page } from '@playwright/test';

export const API_BASE = 'http://localhost:3000';

export const MOCK_USER_NEW = {
  user_id: 'e2e-test-uuid',
  email: 'testuser@mock.plnd',
  display_name: null,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: false,
};

export const MOCK_USER_ONBOARDED = {
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

export const MOCK_PREFS = {
  user_id: 'e2e-test-uuid',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  week_start_day: 1,
  planning_trigger_offset: 0,
  default_plan_length_days: 7,
  wake_time: '07:00:00',
};

export const MOCK_BRIEFING_WEATHER = {
  temp_c: 18,
  condition: 'Clear',
  high_c: 22,
  low_c: 14,
  precipitation_flag: false,
};

export const MOCK_BRIEFING_NEWS = {
  headlines: ['Test headline one', 'Test headline two', 'Test headline three'],
};

export const MOCK_SCHEDULE_PERIOD = {
  entries: [
    {
      entry_id: 'e2e-entry-uuid',
      task_type: 'task',
      title: 'Morning exercise',
      date: '2026-03-28',
      scheduled_start: '2026-03-28T07:00:00Z',
      status: 'pending',
    },
  ],
  carryover: [],
};

export const MOCK_BRIEFING_YESTERDAY = {
  tasks_done: 3,
  tasks_total: 5,
  meals_logged: 2,
  meals_planned: 3,
};

export async function seedAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'synthetic.test.token');
  });
  await page.route(`${API_BASE}/users/me`, route =>
    route.fulfill({ status: 200, json: MOCK_USER_ONBOARDED })
  );
  await page.route(`${API_BASE}/preferences/me`, route =>
    route.fulfill({ status: 200, json: MOCK_PREFS })
  );
  await page.route(`${API_BASE}/schedule/plan/status**`, route =>
    route.fulfill({ status: 200, json: { planned: false } })
  );
  await page.route(`${API_BASE}/my/meal-suggestions**`, route =>
    route.fulfill({ status: 200, json: [] })
  );
  await page.route(`${API_BASE}/schedule/period**`, route =>
    route.fulfill({ status: 200, json: MOCK_SCHEDULE_PERIOD })
  );
  await page.route(`${API_BASE}/briefing/weather`, route =>
    route.fulfill({ status: 200, json: MOCK_BRIEFING_WEATHER })
  );
  await page.route(`${API_BASE}/briefing/news`, route =>
    route.fulfill({ status: 200, json: MOCK_BRIEFING_NEWS })
  );
  await page.route(`${API_BASE}/briefing/yesterday`, route =>
    route.fulfill({ status: 200, json: MOCK_BRIEFING_YESTERDAY })
  );
}
