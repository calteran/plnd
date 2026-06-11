import { Page } from '@playwright/test';
import { generateTestSub, injectAuthToken, seedTestState } from './auth';

// ── Agent fixtures (LLM endpoints) ────────────────────────────────────────────
//
// The remaining exports here are response bodies for the two agent endpoints
// that e2e tests are still permitted to mock per docs/architecture.md §9.7:
//   * POST /agent/place-tasks  — task placement substep
//   * POST /agent/meal-plan    — meal plan generation substep
// All non-agent endpoints (day-types, routines, dietary restrictions, etc.)
// flow through the real backend via seed helpers in ./seed-data.ts.

// ── Task Placement (POST /agent/place-tasks) ──────────────────────────────────
//
// Dates fall inside the first onboarding window. seedOnboarding fixes the clock
// to Sat 2026-03-28 and the seeded "new" user has week_start_day=Mon, offset=0,
// length=7, so the first window starts the day AFTER today (Sun 2026-03-29) and
// runs to Sun 2026-04-05 (computeFirstPlanPeriod rolls into the following week
// because plan_start lands on the last day of the current week). 'Morning run'
// is dated to the first window day so it renders in the first day card.

export const MOCK_PLACED_TASKS = [
  {
    title: 'Morning run',
    scheduled_date: '2026-03-29',
    time_window_start: '07:30',
    duration_minutes: 30,
    energy_required: 'high',
    task_type: 'general',
  },
  {
    title: 'Read book',
    scheduled_date: '2026-03-30',
    time_window_start: '20:00',
    duration_minutes: 45,
    energy_required: 'low',
    task_type: 'general',
  },
];

// ── Meal Plan (POST /agent/meal-plan) ─────────────────────────────────────────
//
// Uses real UUID strings for meal_ref.id so the downstream POST /schedule/plan
// commit (which forwards meal refs into the meal_entries field on
// PostSchedulePlanRequest) parses successfully against the real backend during
// the full happy-path tests.

export const MOCK_MEAL_PLAN = {
  plan_start: '2026-03-29',
  meals: [
    {
      date: '2026-03-29',
      meal_name: 'breakfast',
      meal_ref: { id: '11111111-1111-4111-8111-111111111111', type: 'catalog' },
      title: 'Oatmeal',
      estimated: true,
    },
    {
      date: '2026-03-29',
      meal_name: 'lunch',
      meal_ref: { id: '22222222-2222-4222-8222-222222222222', type: 'catalog' },
      title: 'Salad',
      estimated: true,
    },
  ],
};

// ── Meal Plan, slot-name aligned (POST /agent/meal-plan) ──────────────────────
//
// MOCK_MEAL_PLAN above uses lowercase `meal_name`, which does NOT match the
// capitalized day-type slots seeded by `seedWeekdaysWeekends`
// (Breakfast/Lunch/Dinner). The client keys meal cells by `(date, slot-name)`,
// so the lowercase mock produces an empty onboarding meal grid and the commit
// forwards ZERO `meal_entries` — which is why the existing happy-path commit
// tests pass without seeding any `meal_anchor_instances`.
//
// This variant capitalizes `meal_name` to match the seeded slots, so the grid
// renders and the commit forwards REAL `meal_entries`. It must be paired with
// seeded `meal_anchor_instances` for the same `(date, name)` pairs (see
// `seedDayMealAnchors` in onboarding.e2e.ts), since `commit_plan` pairs each
// staged meal against an existing instance and 500s otherwise. Used by the
// meal-persistence e2e coverage for #887.
//
// Dates match the first onboarding plan window: with the clock fixed to Sat
// 2026-03-28, the first window starts the day after (Sun 2026-03-29) per #888,
// so a meal must be dated inside [plan_start, plan_end] or buildMealPlanResponse
// drops it. 2026-03-29 is a Sunday → the seeded Weekends day type (Breakfast/
// Lunch/Dinner slots).
export const MOCK_MEAL_PLAN_MATCHED = {
  plan_start: '2026-03-29',
  meals: [
    {
      date: '2026-03-29',
      meal_name: 'Breakfast',
      meal_ref: { id: '11111111-1111-4111-8111-111111111111', type: 'catalog' },
      title: 'Oatmeal',
      estimated: true,
    },
    {
      date: '2026-03-29',
      meal_name: 'Lunch',
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

