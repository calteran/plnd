import { Page } from '@playwright/test';
import { API_BASE, generateTestSub, injectAuthToken, seedTestState } from './auth';

// ── Agent fixtures (LLM endpoints) ────────────────────────────────────────────
//
// The remaining exports here are response bodies for the two agent endpoints
// that e2e tests are still permitted to mock per docs/architecture.md §9.7:
//   * POST /agent/place-tasks  — task placement substep
//   * POST /agent/meal-plan    — meal plan generation substep
// All non-agent endpoints (day-types, routines, dietary restrictions, etc.)
// flow through the real backend via seed helpers in ./seed-data.ts.

// ── Task Placement (POST /agent/place-tasks) ──────────────────────────────────

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

// ── Meal Plan (POST /agent/meal-plan) ─────────────────────────────────────────
//
// Uses real UUID strings for meal_ref.id so the downstream POST /schedule/plan
// commit (which serializes task_ref_id: Option<Uuid> in plnd_api) parses
// successfully against the real backend during the full happy-path tests.

export const MOCK_MEAL_PLAN = {
  plan_start: '2026-03-28',
  meals: [
    {
      date: '2026-03-28',
      meal_name: 'breakfast',
      meal_ref: { id: '11111111-1111-4111-8111-111111111111', type: 'catalog' },
      title: 'Oatmeal',
      estimated: true,
    },
    {
      date: '2026-03-28',
      meal_name: 'lunch',
      meal_ref: { id: '22222222-2222-4222-8222-222222222222', type: 'catalog' },
      title: 'Salad',
      estimated: true,
    },
  ],
};

// ── seedOnboarding ────────────────────────────────────────────────────────────
// Sets up a non-onboarded user session with fixed clock 2026-03-28. Each call
// generates a fresh per-test sub so parallel tests cannot collide on writes —
// `user_id` is the isolation boundary (see docs/architecture.md §9). The
// real backend serves /users/me, /preferences/me, /dietary-restrictions,
// /day-types, /routines, /my/* etc. directly for this user. Returns the
// generated sub so callers can chain seed helpers from ./seed-data.ts.

export async function seedOnboarding(page: Page): Promise<{ sub: string }> {
  await page.clock.setFixedTime('2026-03-28T00:00:00');
  const sub = generateTestSub();
  await injectAuthToken(page, sub);
  await seedTestState(sub, { preset: 'new' });
  return { sub };
}

/**
 * Mock GET /my/meals and GET /my/dishes to empty arrays.
 *
 * Used by the planning-wizard tests (`planning-wizard*.e2e.ts`) which still
 * rely on shaped fixtures for the meal-plan loader. The onboarding tests no
 * longer need this because they hit the real backend (seed empty user → empty
 * arrays naturally). Once the planning-wizard tests are de-mocked this helper
 * can be removed.
 */
export async function mockUserCatalogEmpty(page: Page): Promise<void> {
  await page.route(`${API_BASE}/my/meals`, route =>
    route.fulfill({ status: 200, json: [] })
  );
  await page.route(`${API_BASE}/my/dishes`, route =>
    route.fulfill({ status: 200, json: [] })
  );
}
