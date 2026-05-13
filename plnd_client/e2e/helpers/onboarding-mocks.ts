import { Page } from '@playwright/test';
import { API_BASE, injectAuthToken, seedTestState, SEED_ONBOARDING_SUB } from './auth';

// ── Day Types ─────────────────────────────────────────────────────────────────

export const MOCK_DAY_TYPE_WEEKDAYS = {
  id: 'st-weekdays-uuid',
  name: 'Weekdays',
  days_bitmask: 62,
  wake_time: '07:00:00',
  sleep_time: '22:00:00',
  is_cycle: false,
  cycle_length: null,
  anchor_date: null,
};

export const MOCK_DAY_TYPE_WEEKENDS = {
  id: 'st-weekends-uuid',
  name: 'Weekends',
  days_bitmask: 65,
  wake_time: '08:00:00',
  sleep_time: '23:00:00',
  is_cycle: false,
  cycle_length: null,
  anchor_date: null,
};

// ── Routines ──────────────────────────────────────────────────────────────────

export const MOCK_TEMPLATE_MORNING_WALK = {
  routine_id: 'tmpl-morning-walk-uuid',
  task_type: 'general',
  title: 'Morning walk',
  recurrence_tag: 'daily',
  recurrence_rule: 'FREQ=DAILY',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// ── Task Placement ────────────────────────────────────────────────────────────

export const MOCK_PLACED_TASKS = [
  {
    title: 'Morning run',
    scheduled_date: '2026-03-28',
    time_window_start: '07:30',
    duration_minutes: 30,
    energy_required: 'high',
    task_type: 'general',
  },
  {
    title: 'Read book',
    scheduled_date: '2026-03-29',
    time_window_start: '20:00',
    duration_minutes: 45,
    energy_required: 'low',
    task_type: 'general',
  },
];

// ── Meal Plan ─────────────────────────────────────────────────────────────────

export const MOCK_MEAL_PLAN = {
  plan_start: '2026-03-28',
  meals: [
    {
      date: '2026-03-28',
      meal_name: 'breakfast',
      meal_ref: { id: 'meal-oatmeal-uuid', type: 'catalog' },
      title: 'Oatmeal',
      estimated: true,
    },
    {
      date: '2026-03-28',
      meal_name: 'lunch',
      meal_ref: { id: 'meal-salad-uuid', type: 'catalog' },
      title: 'Salad',
      estimated: true,
    },
  ],
};

// ── Meal Habits ───────────────────────────────────────────────────────────────

export const MOCK_MEAL_HABIT = {
  id: 'habit-oatmeal-uuid',
  meal_name: 'Oatmeal',
  slot: 'breakfast',
  recurrence_rule: 'FREQ=DAILY',
};

// ── Dietary Restrictions ──────────────────────────────────────────────────────

export const MOCK_DIETARY_RESTRICTION_ALLERGY = {
  restriction_id: 'restriction-peanuts-uuid',
  name: 'Peanuts',
  restriction_type: 'allergy',
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
};

// ── Plan commit ───────────────────────────────────────────────────────────────

export const MOCK_PLAN_COMMITTED = {
  committed: 3,
  planning_task_status: 'done',
};

// ── seedOnboarding ────────────────────────────────────────────────────────────
// Sets up a non-onboarded user session with fixed clock 2026-03-28.
// The user's /users/me, /preferences/me, and /dietary-restrictions responses
// are now served by the real backend (auto-created during /auth/token exchange,
// reconciled by /test/seed). Override individual routes after calling this for
// test-specific data shaping.

export async function seedOnboarding(page: Page): Promise<void> {
  await page.clock.setFixedTime('2026-03-28T00:00:00');
  await injectAuthToken(page, SEED_ONBOARDING_SUB);
  await seedTestState(SEED_ONBOARDING_SUB, { preset: 'new' });
  await mockUserCatalogEmpty(page);
}

/**
 * Mock GET /my/meals and GET /my/dishes to empty arrays.
 *
 * plan-meals-step (used by the planning wizard step 3 and onboarding food
 * spoke) calls `userMealsService.load()` and `userDishesService.load()` on
 * init to drive blocked-item personalization in the meal-plan loader.
 * Without these mocks, the synthetic test token hits the real backend,
 * returns 401, and `authErrorInterceptor` triggers a session_expired
 * redirect — which silently breaks downstream test assertions.
 *
 * Call from every test helper that navigates to a route that mounts
 * plan-meals-step.
 */
export async function mockUserCatalogEmpty(page: Page): Promise<void> {
  await page.route(`${API_BASE}/my/meals`, route =>
    route.fulfill({ status: 200, json: [] })
  );
  await page.route(`${API_BASE}/my/dishes`, route =>
    route.fulfill({ status: 200, json: [] })
  );
}
