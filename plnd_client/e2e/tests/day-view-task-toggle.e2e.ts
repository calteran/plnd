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

test.describe('Day View — Task Completion Toggle', () => {

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime('2026-03-28T00:00:00');
    await seedAuth(page);
  });

  // ── Incomplete → complete ────────────────────────────────────────────────

  test.describe('marking an incomplete task as complete', () => {
    // Use a non-today date so mock data returns all tasks as pending.
    const PENDING_DATE = '2026-03-29';

    test('clicking the checkbox sets aria-checked to true', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(PENDING_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      const checkbox = dayView.getTaskRowCheckbox(row);

      await expect(checkbox).toHaveAttribute('aria-checked', 'false');
      await checkbox.click();
      await expect(checkbox).toHaveAttribute('aria-checked', 'true');
    });

    test('the task row gains the done class after toggling', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(PENDING_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      await expect(dayView.getTaskRowInner(row)).not.toHaveClass(/done/);
      await dayView.getTaskRowCheckbox(row).click();
      await expect(dayView.getTaskRowInner(row)).toHaveClass(/done/);
    });

    test('the task label gains the struck class after toggling', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(PENDING_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      await expect(dayView.getTaskRowLabel(row)).not.toHaveClass(/struck/);
      await dayView.getTaskRowCheckbox(row).click();
      await expect(dayView.getTaskRowLabel(row)).toHaveClass(/struck/);
    });
  });

  // ── Complete → incomplete ────────────────────────────────────────────────

  test.describe('marking a complete task as incomplete', () => {
    // Today's date (2026-03-28) — mock data returns top-level tasks as done.
    const TODAY_DATE = '2026-03-28';

    test('clicking the checkbox sets aria-checked to false', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(TODAY_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      const checkbox = dayView.getTaskRowCheckbox(row);

      await expect(checkbox).toHaveAttribute('aria-checked', 'true');
      await checkbox.click();
      await expect(checkbox).toHaveAttribute('aria-checked', 'false');
    });

    test('the task row loses the done class after toggling', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(TODAY_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      await expect(dayView.getTaskRowInner(row)).toHaveClass(/done/);
      await dayView.getTaskRowCheckbox(row).click();
      await expect(dayView.getTaskRowInner(row)).not.toHaveClass(/done/);
    });

    test('the task label loses the struck class after toggling', async ({ page }) => {
      const dayView = new DayViewPage(page);
      await dayView.gotoDate(TODAY_DATE);
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

      const row = dayView.getTaskRows().first();
      await expect(dayView.getTaskRowLabel(row)).toHaveClass(/struck/);
      await dayView.getTaskRowCheckbox(row).click();
      await expect(dayView.getTaskRowLabel(row)).not.toHaveClass(/struck/);
    });
  });

  // ── API integration ──────────────────────────────────────────────────────

  test.describe('API integration', () => {
    // These tests are deferred until ScheduleService.toggleItem() sends an
    // HTTP request. Remove test.fail() when the HttpClient implementation lands.

    test('toggling an incomplete task sends PATCH with status: done', async ({ page }) => {
      test.fail(); // TODO: remove when ScheduleService.toggleItem() uses HttpClient

      let capturedBody: Record<string, unknown> | null = null;
      await page.route(`${API_BASE}/schedule/items/**`, async route => {
        if (route.request().method() === 'PATCH') {
          capturedBody = route.request().postDataJSON() as Record<string, unknown>;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
        } else {
          await route.continue();
        }
      });

      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-29');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.getTaskRowCheckbox(dayView.getTaskRows().first()).click();

      expect(capturedBody).not.toBeNull();
      expect(capturedBody!['status']).toBe('done');
    });

    test('toggling a complete task sends PATCH with status: pending', async ({ page }) => {
      test.fail(); // TODO: remove when ScheduleService.toggleItem() uses HttpClient

      let capturedBody: Record<string, unknown> | null = null;
      await page.route(`${API_BASE}/schedule/items/**`, async route => {
        if (route.request().method() === 'PATCH') {
          capturedBody = route.request().postDataJSON() as Record<string, unknown>;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
        } else {
          await route.continue();
        }
      });

      const dayView = new DayViewPage(page);
      await dayView.gotoDate('2026-03-28');
      await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });
      await dayView.getTaskRowCheckbox(dayView.getTaskRows().first()).click();

      expect(capturedBody).not.toBeNull();
      expect(capturedBody!['status']).toBe('pending');
    });
  });

});
