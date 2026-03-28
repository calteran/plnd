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
}
