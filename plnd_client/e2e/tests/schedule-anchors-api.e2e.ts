import { test, expect } from '../fixtures';
import { API_BASE, mintTestToken, generateTestSub } from '../helpers/auth';

// Per-date meal anchor instance CRUD — API-only e2e (issue #828).
//
// The UI affordance is tracked separately as #826. Until that lands these
// tests exercise the backend via direct REST calls, which is the same shape
// the UI will use once it's built. They run through the real auth flow and
// the real backend (per docs/architecture.md §9.7).

// POST / PATCH / status return a single MealAnchorInstanceResponse (the meal
// instance that was mutated): id/name/preferred_time/status/... .
interface AnchorResponse {
  id: string;
  user_id: string;
  date: string;
  name: string;
  preferred_time: string;
  tolerance_minutes: number;
  sort_order: number;
  template_entry_id: string | null;
  status: string;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
}

// GET /schedule/anchors returns the unified, ordered anchor sequence (#958):
// all four sources flattened, keyed on `kind`, with `label`/`time`/`sequence`
// instead of the meal instance's `name`/`preferred_time`.
interface ScheduleAnchor {
  kind: 'meal' | 'scheduled_task' | 'start_of_day' | 'end_of_day' | 'timezone_change';
  sequence: number;
  time: string;
  label: string;
  id: string | null;
  status: string | null;
  zone: string | null;
}

async function authHeaders(sub: string): Promise<Record<string, string>> {
  const token = await mintTestToken(sub);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test.describe('Schedule anchors — per-date meal anchor instances (API)', () => {
  test('add → list shows new instance', async () => {
    const sub = generateTestSub();
    const headers = await authHeaders(sub);
    const date = isoDate(7);

    const addRes = await fetch(`${API_BASE}/schedule/anchors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ date, name: 'Brunch', preferred_time: '10:30' }),
    });
    expect(addRes.status).toBe(201);
    const added = (await addRes.json()) as AnchorResponse;
    expect(added.name).toBe('Brunch');
    expect(added.preferred_time).toMatch(/^10:30/);
    expect(added.template_entry_id).toBeNull();

    const listRes = await fetch(`${API_BASE}/schedule/anchors?date=${date}`, { headers });
    expect(listRes.status).toBe(200);
    // GET returns the unified sequence (#958): the meal anchor surfaces as a
    // kind=meal entry whose `label` is the meal name.
    const list = (await listRes.json()) as ScheduleAnchor[];
    const mealLabels = list.filter((a) => a.kind === 'meal').map((a) => a.label);
    expect(mealLabels).toContain('Brunch');
  });

  test('rename via PATCH updates name only', async () => {
    const sub = generateTestSub();
    const headers = await authHeaders(sub);
    const date = isoDate(7);

    const addRes = await fetch(`${API_BASE}/schedule/anchors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ date, name: 'Lunch', preferred_time: '12:00' }),
    });
    const inst = (await addRes.json()) as AnchorResponse;

    const patchRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Late Lunch' }),
    });
    expect(patchRes.status).toBe(200);
    const renamed = (await patchRes.json()) as AnchorResponse;
    expect(renamed.name).toBe('Late Lunch');
    expect(renamed.preferred_time).toMatch(/^12:00/);
  });

  test('retime via PATCH updates time + tolerance', async () => {
    const sub = generateTestSub();
    const headers = await authHeaders(sub);
    const date = isoDate(7);

    const addRes = await fetch(`${API_BASE}/schedule/anchors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ date, name: 'Dinner', preferred_time: '18:00' }),
    });
    const inst = (await addRes.json()) as AnchorResponse;

    const patchRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ preferred_time: '19:30', tolerance_minutes: 45 }),
    });
    expect(patchRes.status).toBe(200);
    const retimed = (await patchRes.json()) as AnchorResponse;
    expect(retimed.preferred_time).toMatch(/^19:30/);
    expect(retimed.tolerance_minutes).toBe(45);
    expect(retimed.name).toBe('Dinner');
  });

  test('delete removes the instance', async () => {
    const sub = generateTestSub();
    const headers = await authHeaders(sub);
    const date = isoDate(7);

    const addRes = await fetch(`${API_BASE}/schedule/anchors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ date, name: 'Snack', preferred_time: '15:00' }),
    });
    const inst = (await addRes.json()) as AnchorResponse;

    const delRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(delRes.status).toBe(204);

    const listRes = await fetch(`${API_BASE}/schedule/anchors?date=${date}`, { headers });
    const list = (await listRes.json()) as ScheduleAnchor[];
    expect(list.map((a) => a.id)).not.toContain(inst.id);
  });

  test('past-date add accepted', async () => {
    const sub = generateTestSub();
    const headers = await authHeaders(sub);
    const date = isoDate(-1); // yesterday

    const addRes = await fetch(`${API_BASE}/schedule/anchors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        date,
        name: 'Late-night Snack',
        preferred_time: '23:00',
      }),
    });
    expect(addRes.status).toBe(201);
  });

  test('GET on untouched future date materializes (returns empty when no template applies)', async () => {
    const sub = generateTestSub();
    const headers = await authHeaders(sub);
    const date = isoDate(60); // far future

    const listRes = await fetch(`${API_BASE}/schedule/anchors?date=${date}`, { headers });
    expect(listRes.status).toBe(200);
    // New user has no day-type templates seeded, so the unified sequence is
    // empty: no active day type means no start/end-of-day, and no meals/tasks/
    // tz changes. The materialization marker has still been written; subsequent
    // reads stay empty and do not re-import a template.
    const list = (await listRes.json()) as ScheduleAnchor[];
    expect(list).toEqual([]);
  });

  test('PATCH status: consumed stamps consumed_at; skipped and revert clear it; bad value 422; unknown id 404', async () => {
    const sub = generateTestSub();
    const headers = await authHeaders(sub);
    const date = isoDate(-1); // yesterday — past-date logging allowed

    const addRes = await fetch(`${API_BASE}/schedule/anchors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ date, name: 'Lunch', preferred_time: '12:00' }),
    });
    const inst = (await addRes.json()) as AnchorResponse;
    expect(inst.status).toBe('planned');
    expect(inst.consumed_at).toBeNull();

    // → consumed
    const consumedRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'consumed' }),
    });
    expect(consumedRes.status).toBe(200);
    const consumed = (await consumedRes.json()) as AnchorResponse;
    expect(consumed.status).toBe('consumed');
    expect(consumed.consumed_at).not.toBeNull();

    // → skipped (clears consumed_at)
    const skippedRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'skipped' }),
    });
    expect(skippedRes.status).toBe(200);
    const skipped = (await skippedRes.json()) as AnchorResponse;
    expect(skipped.status).toBe('skipped');
    expect(skipped.consumed_at).toBeNull();

    // → revert to planned
    const plannedRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'planned' }),
    });
    expect(plannedRes.status).toBe(200);
    expect(((await plannedRes.json()) as AnchorResponse).status).toBe('planned');

    // invalid status value → 422
    const badRes = await fetch(`${API_BASE}/schedule/anchors/${inst.id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'eaten' }),
    });
    expect(badRes.status).toBe(422);

    // unknown id → 404
    const missingRes = await fetch(
      `${API_BASE}/schedule/anchors/00000000-0000-0000-0000-000000000000/status`,
      { method: 'PATCH', headers, body: JSON.stringify({ status: 'consumed' }) },
    );
    expect(missingRes.status).toBe(404);
  });
});
