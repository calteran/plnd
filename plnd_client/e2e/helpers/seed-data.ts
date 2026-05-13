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

interface SchedulePeriodEntry {
  entry_id: string;
  title?: string;
  date: string;
  status: string;
  after_anchor?: string;
}

/**
 * Seeds schedule entries for the authenticated test user by driving the real
 * backend through three public endpoints:
 *
 *   1. POST /tasks/weekly-plan?plan_start=… → creates the planning task (real
 *      schedule_repo write) and returns its task_id.
 *   2. POST /schedule/plan with planning_task_id + entries + placed_tasks →
 *      commits entries to the DB (real schedule_repo write). All entries
 *      default to status='planned'.
 *   3. (Optional) For any entry with a non-default `status`, GET
 *      /schedule/period to discover entry IDs by (title, date), then PATCH
 *      /schedule/entries/{id}/status per entry.
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

  const wantsStatusChange = [...entries, ...placedTasks].some(
    e => e.status && e.status !== 'planned',
  );
  if (!wantsStatusChange) return;

  const periodRes = await fetch(
    `${API_BASE}/schedule/period?start=${opts.plan_start}&end=${opts.plan_end}`,
    { headers: auth },
  );
  if (!periodRes.ok) {
    const text = await periodRes.text().catch(() => '<no body>');
    throw new Error(
      `seedScheduleEntries: GET /schedule/period returned ${periodRes.status}. Body: ${text.slice(0, 200)}`,
    );
  }
  const period = (await periodRes.json()) as { entries: SchedulePeriodEntry[] };

  for (const wanted of [...entries, ...placedTasks]) {
    if (!wanted.status || wanted.status === 'planned') continue;
    const found = period.entries.find(
      e =>
        e.date === wanted.date &&
        (e.title ?? null) === (wanted.title ?? null) &&
        (e.after_anchor ?? null) === (wanted.after_anchor ?? null),
    );
    if (!found) {
      throw new Error(
        `seedScheduleEntries: could not find committed entry for (date=${wanted.date}, title=${wanted.title}, after_anchor=${wanted.after_anchor}) to PATCH status. Got ${period.entries.length} entries back.`,
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
