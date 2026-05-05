import { Page } from '@playwright/test';
import { API_BASE, MOCK_USER_NEW, MOCK_PREFS } from './auth';

// ── Schedule Types ────────────────────────────────────────────────────────────

export const MOCK_SCHEDULE_TYPE_WEEKDAYS = {
  id: 'st-weekdays-uuid',
  name: 'Weekdays',
  days_bitmask: 62,
  wake_time: '07:00:00',
  bed_time: '22:00:00',
  is_cycle: false,
  cycle_length: null,
  anchor_date: null,
};

export const MOCK_SCHEDULE_TYPE_WEEKENDS = {
  id: 'st-weekends-uuid',
  name: 'Weekends',
  days_bitmask: 65,
  wake_time: '08:00:00',
  bed_time: '23:00:00',
  is_cycle: false,
  cycle_length: null,
  anchor_date: null,
};

// ── Routines ──────────────────────────────────────────────────────────────────

export const MOCK_TEMPLATE_MORNING_WALK = {
  routine_id: 'tmpl-morning-walk-uuid',
  task_type: 'general',
  title: 'Morning walk',
  recurrence: 'daily',
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
      occasion: 'breakfast',
      meal_ref: { id: 'meal-oatmeal-uuid', type: 'catalog' },
      title: 'Oatmeal',
      estimated: true,
    },
    {
      date: '2026-03-28',
      occasion: 'lunch',
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
// Sets up a new (non-onboarded) user session with fixed clock 2026-03-28.
// Handles both GET and PATCH for preferences/me (component only needs 200 + valid body).
// Override individual routes after calling this (LIFO: last handler wins).

export async function seedOnboarding(page: Page): Promise<void> {
  await page.clock.setFixedTime('2026-03-28T00:00:00');
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'synthetic.test.token');
  });
  await page.route(`${API_BASE}/users/me`, route =>
    route.fulfill({ status: 200, json: MOCK_USER_NEW })
  );
  await page.route(`${API_BASE}/dietary-restrictions`, route =>
    route.fulfill({ status: 200, json: [] })
  );
  // Handles both GET and PATCH (component only needs a 200 + valid body)
  await page.route(`${API_BASE}/preferences/me`, route =>
    route.fulfill({ status: 200, json: MOCK_PREFS })
  );
}
