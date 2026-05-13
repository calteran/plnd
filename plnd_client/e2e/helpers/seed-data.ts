// Domain-data seeding helpers for e2e tests.
//
// Pattern: each helper authenticates with a per-test sub (see auth.ts) and
// drives the real backend through its public API endpoints to set up state.
// This is the canonical extension point for new seeding needs (routines,
// dietary restrictions, meal preferences, etc.) — prefer adding a helper here
// over extending /test/seed, so tests exercise the same code path as users.
//
// See docs/architecture.md §9 for the policy and the rationale (per-test user
// accounts as the isolation primitive; no shared-state writes; mocks reserved
// for agent endpoints and genuinely external services).

import { API_BASE, mintTestToken } from './auth';

// ── seedScheduleEntries ──────────────────────────────────────────────────────

export interface ScheduleEntryInput {
  /** ISO date 'YYYY-MM-DD'. Must fall within [plan_start, plan_end]. */
  date: string;
  /** 'task' for one-off tasks; null/undefined for meal anchors (use after_anchor). */
  task_type?: string | null;
  /** Title for tasks; omit for meal anchors. */
  title?: string;
  /** 'HH:MM' or 'HH:MM:SS' UTC; omit for slot tasks bound to an anchor. */
  scheduled_start?: string;
  /** Meal-slot name for after-meal tasks or meal anchors ('breakfast', etc.). */
  after_anchor?: string;
  duration_minutes?: number;
  energy_required?: 'low' | 'medium' | 'high';
  one_shot?: boolean;
  /**
   * Desired post-commit status. Entries default to 'planned' after commit_plan.
   * If set to anything else (e.g. 'completed'), the helper performs a follow-up
   * GET /schedule/period + PATCH /schedule/entries/{id}/status round-trip to
   * reconcile.
   */
  status?: 'planned' | 'in_progress' | 'completed' | 'skipped' | 'deferred';
}

export interface SeedScheduleOptions {
  /** ISO date 'YYYY-MM-DD' — start of the planning window (typically a Monday). */
  plan_start: string;
  /** ISO date 'YYYY-MM-DD' — inclusive end. */
  plan_end: string;
  /** Meal anchors and recurring meal entries (use after_anchor, no task_type). */
  entries?: ScheduleEntryInput[];
  /** One-off tasks placed in the schedule (task_type='task' + title). */
  placed_tasks?: ScheduleEntryInput[];
}

interface CommittedPlanEntry {
  entry_id: string;
  title: string | null;
  date: string;
  after_anchor: string | null;
}

interface CommitPlanResult {
  committed: number;
  planning_task_status: string;
  entries: CommittedPlanEntry[];
}

/**
 * Seeds schedule entries for the authenticated test user by driving the real
 * backend through public API endpoints:
 *
 *   1. POST /tasks/weekly-plan?plan_start=… → creates the planning task and
 *      returns its task_id.
 *   2. POST /schedule/plan with planning_task_id + entries + placed_tasks →
 *      commits entries to the DB. All entries default to status='planned'.
 *      The response includes entry IDs for every committed entry.
 *   3. (Optional) For any entry with a non-default `status`, PATCH
 *      /schedule/entries/{id}/status using the IDs from the commit response.
 *
 * Caller is responsible for picking a plan_start that aligns with their test
 * expectations (the planning week is typically Monday-anchored).
 */
export async function seedScheduleEntries(
  sub: string,
  opts: SeedScheduleOptions,
): Promise<void> {
  const token = await mintTestToken(sub);
  const auth = { Authorization: `Bearer ${token}` };
  const jsonAuth = { 'Content-Type': 'application/json', ...auth };

  const planningTaskRes = await fetch(
    `${API_BASE}/tasks/weekly-plan?plan_start=${opts.plan_start}`,
    { method: 'POST', headers: auth },
  );
  if (!planningTaskRes.ok) {
    const text = await planningTaskRes.text().catch(() => '<no body>');
    throw new Error(
      `seedScheduleEntries: POST /tasks/weekly-plan returned ${planningTaskRes.status}. Body: ${text.slice(0, 200)}`,
    );
  }
  const planningTask = (await planningTaskRes.json()) as { task_id: string };

  const entries = opts.entries ?? [];
  const placedTasks = opts.placed_tasks ?? [];

  const commitRes = await fetch(`${API_BASE}/schedule/plan`, {
    method: 'POST',
    headers: jsonAuth,
    body: JSON.stringify({
      plan_start: opts.plan_start,
      plan_end: opts.plan_end,
      planning_task_id: planningTask.task_id,
      entries: entries.map(stripStatus),
      placed_tasks: placedTasks.map(stripStatus),
      replace: true,
    }),
  });
  if (!commitRes.ok) {
    const text = await commitRes.text().catch(() => '<no body>');
    throw new Error(
      `seedScheduleEntries: POST /schedule/plan returned ${commitRes.status}. Body: ${text.slice(0, 200)}`,
    );
  }
  const commitResult = (await commitRes.json()) as CommitPlanResult;

  const wantsStatusChange = [...entries, ...placedTasks].some(
    e => e.status && e.status !== 'planned',
  );
  if (!wantsStatusChange) return;

  for (const wanted of [...entries, ...placedTasks]) {
    if (!wanted.status || wanted.status === 'planned') continue;
    const found = commitResult.entries.find(
      e =>
        e.date === wanted.date &&
        (e.title ?? null) === (wanted.title ?? null) &&
        (e.after_anchor ?? null) === (wanted.after_anchor ?? null),
    );
    if (!found) {
      throw new Error(
        `seedScheduleEntries: could not find committed entry for (date=${wanted.date}, title=${wanted.title}, after_anchor=${wanted.after_anchor}) in commit response. Got ${commitResult.entries.length} entries back.`,
      );
    }
    const patchRes = await fetch(`${API_BASE}/schedule/entries/${found.entry_id}/status`, {
      method: 'PATCH',
      headers: jsonAuth,
      body: JSON.stringify({ status: wanted.status }),
    });
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => '<no body>');
      throw new Error(
        `seedScheduleEntries: PATCH /schedule/entries/${found.entry_id}/status returned ${patchRes.status}. Body: ${text.slice(0, 200)}`,
      );
    }
  }
}

function stripStatus(e: ScheduleEntryInput): Omit<ScheduleEntryInput, 'status'> {
  const rest: Omit<ScheduleEntryInput, 'status'> & { status?: ScheduleEntryInput['status'] } = { ...e };
  delete rest.status;
  return rest;
}

// ── Internal: shared API call helper ─────────────────────────────────────────

async function callApi(
  sub: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  helperName = 'callApi',
): Promise<Response> {
  const token = await mintTestToken(sub);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(
      `${helperName}: ${method} ${path} returned ${res.status}. Body: ${text.slice(0, 200)}`,
    );
  }
  return res;
}

// ── seedRoutines ─────────────────────────────────────────────────────────────

export interface RoutineInput {
  task_type: string;
  title: string;
  recurrence_rule: string;
  recurrence_tag?: string;
  time_window_start?: string;
  time_window_end?: string;
  duration_minutes?: number;
  energy_required?: 'low' | 'medium' | 'high';
  is_anchor?: boolean;
}

export interface SeededRoutine {
  routine_id: string;
  task_type: string;
  title: string;
  recurrence_rule: string;
}

export async function seedRoutines(sub: string, routines: RoutineInput[]): Promise<SeededRoutine[]> {
  const results: SeededRoutine[] = [];
  for (const r of routines) {
    const res = await callApi(sub, 'POST', '/routines', r, 'seedRoutines');
    results.push((await res.json()) as SeededRoutine);
  }
  return results;
}

// ── seedDietaryRestrictions ──────────────────────────────────────────────────

export interface DietaryRestrictionInput {
  restriction_type: 'allergy' | 'intolerance' | 'preference' | 'cultural_religious';
  name: string;
  notes?: string;
}

export interface SeededDietaryRestriction {
  restriction_id: string;
  name: string;
  restriction_type: string;
  notes: string | null;
  created_at: string;
}

export async function seedDietaryRestrictions(
  sub: string,
  restrictions: DietaryRestrictionInput[],
): Promise<SeededDietaryRestriction[]> {
  const results: SeededDietaryRestriction[] = [];
  for (const r of restrictions) {
    const res = await callApi(sub, 'POST', '/dietary-restrictions', r, 'seedDietaryRestrictions');
    results.push((await res.json()) as SeededDietaryRestriction);
  }
  return results;
}

// ── seedDayType + seedDayTypeMeal ────────────────────────────────────────────

export interface DayTypeInput {
  name: string;
  /** Bitmask of weekdays: bit 0=Sunday, bit 1=Monday, …, bit 6=Saturday. */
  days_bitmask: number;
  /** 'HH:MM' or 'HH:MM:SS'. */
  wake_time: string;
  /** 'HH:MM' or 'HH:MM:SS'. */
  sleep_time: string;
  is_cycle?: boolean;
  cycle_length?: number;
  anchor_date?: string;
  cycle_bitmask?: number;
}

export interface SeededDayType {
  id: string;
  name: string;
  days_bitmask: number;
}

export async function seedDayType(sub: string, dayType: DayTypeInput): Promise<SeededDayType> {
  const body = { is_cycle: false, ...dayType };
  const res = await callApi(sub, 'POST', '/day-types', body, 'seedDayType');
  return (await res.json()) as SeededDayType;
}

export interface MealPatternInput {
  /** Slot name, e.g. 'breakfast', 'lunch', 'dinner', 'snack'. */
  name: string;
  /** 'HH:MM' or 'HH:MM:SS' UTC. */
  preferred_time: string;
  tolerance_minutes?: number;
  sort_order: number;
}

export interface SeededMealPattern {
  id: string;
  name: string;
  preferred_time: string;
  tolerance_minutes: number;
  sort_order: number;
}

export async function seedDayTypeMeal(
  sub: string,
  dayTypeId: string,
  meal: MealPatternInput,
): Promise<SeededMealPattern> {
  const res = await callApi(
    sub,
    'POST',
    `/day-types/${dayTypeId}/meals`,
    meal,
    'seedDayTypeMeal',
  );
  return (await res.json()) as SeededMealPattern;
}

// ── upsertIngredientPreference ───────────────────────────────────────────────

export interface IngredientPreferenceInput {
  /** −2 = refuse, −1 = tolerate, 0 = neutral, +1 = enjoy, +2 = strongly prefer. */
  preference_score: -2 | -1 | 0 | 1 | 2;
  notes?: string;
}

export async function upsertIngredientPreference(
  sub: string,
  ingredientId: string,
  prefs: IngredientPreferenceInput,
): Promise<void> {
  await callApi(
    sub,
    'PUT',
    `/my/ingredient-prefs/${ingredientId}`,
    prefs,
    'upsertIngredientPreference',
  );
}

// ── patchPreferences ─────────────────────────────────────────────────────────

export interface PreferencesPatch {
  /** 0 = Sunday, 1 = Monday, …, 6 = Saturday. */
  week_start_day?: number;
  /** Days before plan_start to surface the planning task. */
  planning_trigger_offset?: number;
  default_plan_length_days?: number;
  /** 'HH:MM' or 'HH:MM:SS'. */
  planning_time?: string;
}

/**
 * Setup helper for tests that need a non-default user-preferences shape before
 * navigating into the page-under-test. For tests that *exercise* the patch
 * endpoint itself (settings.e2e.ts), drive the request inside the test rather
 * than calling this helper.
 */
export async function patchPreferences(sub: string, prefs: PreferencesPatch): Promise<void> {
  await callApi(sub, 'PATCH', '/preferences/me', prefs, 'patchPreferences');
}

// ── seedDish ─────────────────────────────────────────────────────────────────

export interface DishInput {
  /** Provide either catalog_dish_id OR name (the API rejects neither). */
  catalog_dish_id?: string;
  name?: string;
  instructions?: string;
  prep_time_minutes?: number;
  cook_time_minutes?: number;
}

export interface SeededDish {
  user_dish_pref_id: string;
  name: string;
}

export async function seedDish(sub: string, dish: DishInput): Promise<SeededDish> {
  const res = await callApi(sub, 'POST', '/my/dishes', dish, 'seedDish');
  return (await res.json()) as SeededDish;
}

// ── seedUserMeal ─────────────────────────────────────────────────────────────

export interface UserMealInput {
  /** Provide either catalog_meal_id OR name (the API rejects neither). */
  catalog_meal_id?: string;
  name?: string;
  description?: string;
}

export interface SeededUserMeal {
  user_meal_pref_id: string;
  name: string;
}

export async function seedUserMeal(sub: string, meal: UserMealInput): Promise<SeededUserMeal> {
  const res = await callApi(sub, 'POST', '/my/meals', meal, 'seedUserMeal');
  return (await res.json()) as SeededUserMeal;
}

// ── seedCatalogIngredient ────────────────────────────────────────────────────

export interface SeededCatalogIngredient {
  ingredient_id: string;
}

export async function seedCatalogIngredient(
  sub: string,
  name: string,
): Promise<SeededCatalogIngredient> {
  const res = await callApi(
    sub,
    'POST',
    '/catalog/ingredients',
    { name },
    'seedCatalogIngredient',
  );
  return (await res.json()) as SeededCatalogIngredient;
}
