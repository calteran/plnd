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

test.describe('Day View — Add Entry', () => {

  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
  });

  // Tests go here (Tasks 3–5)

});
