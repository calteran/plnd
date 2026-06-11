# Onboarding First Planning Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the onboarding wizard's first planning window start the day after onboarding and run to the end of the user's current week (per `week_start_day` + `default_plan_length_days`), extending into the following week when little of the current week remains.

**Architecture:** A single pure function — `computeFirstPlanPeriod` in `onboarding-state.service.ts` — derives the window. Both the meal and task onboarding spokes consume its output via the shared `planPeriod` signal, so one change fixes both surfaces. The function gains a `week_start_day` parameter, derives `plan_start = today + 1`, anchors the window on the week boundary, and revives the previously-dead 0.15 roll-over branch. No backend changes (the meal-plan and place-tasks endpoints already accept `plan_start`/`plan_end`).

**Tech Stack:** Angular 19 (signals), TypeScript, Jasmine/Karma unit tests, `just` task runner.

**Spec:** `docs/superpowers/specs/2026-06-11-onboarding-first-window-design.md`

**Working directory:** All paths are relative to the worktree root `/Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window`. Run Angular unit tests from `<worktree>/plnd_client`.

---

### Task 1: Rewrite the unit tests for the new window semantics (red)

The function signature gains a required `week_start_day`, so the existing tests stop compiling. Replace the affected `computeAndSetPlanPeriod`/`planDays` integration tests and the entire `computeFirstPlanPeriod` describe block with cases for the new behavior. All dates below are pre-verified against the calendar (Monday-start week unless noted; `plan_start` is always the day after `today`).

**Files:**
- Test: `plnd_client/src/app/features/onboarding/onboarding-state.service.spec.ts`

- [ ] **Step 1: Update the `computeAndSetPlanPeriod` integration test**

Replace the existing test (the one titled *"computeAndSetPlanPeriod sets planPeriod when preferences are loaded"*, currently asserting `end` `'2026-04-28'`) with:

```typescript
  it('computeAndSetPlanPeriod sets planPeriod when preferences are loaded', () => {
    prefsSignal.set({
      user_id: 'u1',
      week_start_day: 1,
      planning_trigger_offset: -1,
      default_plan_length_days: 7,
      email_notifications_enabled: false,
      sms_notifications_enabled: false,
      push_notifications_enabled: false,
      phone_number: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-22');
    const period = service.planPeriod();
    expect(period).not.toBeNull();
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; current week ends Sun 2026-04-26.
    expect(period!.start).toBe('2026-04-23');
    expect(period!.end).toBe('2026-04-26');
  });
```

- [ ] **Step 2: Update the three `planDays` integration tests**

Replace the tests titled *"planDays computes days between start and end"*, *"planDays works for 14-day plan periods"*, and *"planDays works for 28-day plan periods"* with:

```typescript
  it('planDays counts the inclusive span of the first window', () => {
    prefsSignal.set({
      user_id: 'u1', week_start_day: 1,
      planning_trigger_offset: -1, default_plan_length_days: 7,
      email_notifications_enabled: false, sms_notifications_enabled: false,
      push_notifications_enabled: false, phone_number: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-22');
    // Thu 2026-04-23 – Sun 2026-04-26 → 4 inclusive days.
    expect(service.planDays()).toBe(4);
  });

  it('planDays counts the inclusive span of a 14-day-length first window', () => {
    prefsSignal.set({
      user_id: 'u1', week_start_day: 1,
      planning_trigger_offset: -2, default_plan_length_days: 14,
      email_notifications_enabled: false, sms_notifications_enabled: false,
      push_notifications_enabled: false, phone_number: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-22');
    // Thu 2026-04-23 – Sun 2026-05-03 → 11 inclusive days.
    expect(service.planDays()).toBe(11);
  });

  it('planDays reflects the extended span when the window rolls into the following week', () => {
    prefsSignal.set({
      user_id: 'u1', week_start_day: 1,
      planning_trigger_offset: -1, default_plan_length_days: 7,
      email_notifications_enabled: false, sms_notifications_enabled: false,
      push_notifications_enabled: false, phone_number: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-25');
    // today=Sat 2026-04-25 → plan_start=Sun 2026-04-26 (last day of week) → roll-over
    // to Sun 2026-05-03 → 8 inclusive days.
    expect(service.planDays()).toBe(8);
  });
```

- [ ] **Step 3: Replace the entire `computeFirstPlanPeriod` describe block**

Replace the whole `describe('computeFirstPlanPeriod', () => { ... });` block (currently the last block in the file) with:

```typescript
describe('computeFirstPlanPeriod', () => {
  // All cases use a Monday-start week (week_start_day=1) unless noted.
  // plan_start is always the day AFTER `today`.

  it('normal mid-week: plans from tomorrow to the end of the current week', () => {
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; week Mon–Sun ends Sun 2026-04-26.
    // offset=-1 → trigger Sun 2026-04-26, ratio 3/7=0.43 ≥ 0.15 → normal.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 7, planning_trigger_offset: -1, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-04-26');
  });

  it('onboarding on the week-start day still starts tomorrow', () => {
    // today=Mon 2026-04-20 → plan_start=Tue 2026-04-21; week ends Sun 2026-04-26.
    const result = computeFirstPlanPeriod('2026-04-20', {
      default_plan_length_days: 7, planning_trigger_offset: -1, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-21');
    expect(result.end).toBe('2026-04-26');
  });

  it('rolls into the following week when little of the current week remains', () => {
    // today=Sat 2026-04-25 → plan_start=Sun 2026-04-26 (last day of week).
    // trigger Sun 2026-04-26, days_until_trigger=0, ratio 0 < 0.15 → extend.
    const result = computeFirstPlanPeriod('2026-04-25', {
      default_plan_length_days: 7, planning_trigger_offset: -1, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-26');
    expect(result.end).toBe('2026-05-03');
  });

  it('onboarding on the last day of the week starts a full following week', () => {
    // today=Sun 2026-04-26 → plan_start=Mon 2026-04-27 (next week start) → Mon–Sun.
    const result = computeFirstPlanPeriod('2026-04-26', {
      default_plan_length_days: 7, planning_trigger_offset: -1, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-27');
    expect(result.end).toBe('2026-05-03');
  });

  it('respects a non-Monday week_start_day (Sunday-start week)', () => {
    // week_start_day=0 (Sun). today=Wed 2026-04-22 → plan_start=Thu 2026-04-23.
    // week Sun 2026-04-19 – Sat 2026-04-25; trigger Sat 2026-04-25, ratio 2/7 ≥ 0.15 → normal.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 7, planning_trigger_offset: -1, week_start_day: 0,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-04-25');
  });

  it('works with a 14-day plan length', () => {
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; 14-day period Mon 2026-04-20 – Sun 2026-05-03.
    // offset=-2 → trigger Sat 2026-05-02, ratio 9/14 ≥ 0.15 → normal.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 14, planning_trigger_offset: -2, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-05-03');
  });

  it('threshold: ratio >= 0.15 stays in the current week (offset=-2)', () => {
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; trigger Sat 2026-04-25,
    // days_until_trigger=2, ratio 2/7=0.286 ≥ 0.15 → normal.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 7, planning_trigger_offset: -2, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-04-26');
  });

  it('threshold: ratio < 0.15 rolls into the following week (offset=-3)', () => {
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; trigger Fri 2026-04-24,
    // days_until_trigger=1, ratio 1/7=0.143 < 0.15 → extend.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 7, planning_trigger_offset: -3, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-05-03');
  });

  it('large negative offset lands in the roll-over branch, not a clamp', () => {
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; trigger 2026-04-17,
    // days_until_trigger=-6 < 0.15·7 → extend to following week end 2026-05-03.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 7, planning_trigger_offset: -10, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-05-03');
  });
});
```

- [ ] **Step 4: Run the spec to confirm it fails**

From `<worktree>/plnd_client`:

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/onboarding-state.service.spec.ts'`
Expected: FAIL — TypeScript compile error (the new test object literals include `week_start_day`, which the current `computeFirstPlanPeriod` signature does not accept) and/or assertion failures on the new expected dates.

- [ ] **Step 5: Commit the failing tests**

```bash
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window add plnd_client/src/app/features/onboarding/onboarding-state.service.spec.ts
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window commit -m "test(onboarding): week-aligned first window starting tomorrow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Implement the week-aligned, tomorrow-start window (green)

**Files:**
- Modify: `plnd_client/src/app/features/onboarding/onboarding-state.service.ts` (the exported `computeFirstPlanPeriod` and its preceding comment; leave the `addDays` and `toISODate` helpers and `computeAndSetPlanPeriod` untouched)

- [ ] **Step 1: Replace `computeFirstPlanPeriod` and its leading comment**

Replace the two-line comment block and the entire existing `export function computeFirstPlanPeriod(...) { ... }` (everything from `// Pure function — exported for unit testing without Angular DI.` down to its closing brace, immediately above `function addDays(`) with:

```typescript
// Pure function — exported for unit testing without Angular DI.
/**
 * Compute the user's first planning window during onboarding.
 *
 * The window starts the day AFTER `today` — a new user is never asked to plan a
 * day that has already started — and runs to the end of the week containing that
 * start day, where a "week" is `default_plan_length_days` long and anchored on
 * `week_start_day`. When the next weekly-planning prompt is imminent (less than
 * 15% of a plan length away), the window extends through the following week so the
 * first plan is substantive rather than a one- or two-day stub.
 *
 * Invoked only during onboarding, which offers a 1- or 2-week plan length, so
 * `daysSinceWeekStart` (0–6) is always < planLength and the window is non-empty;
 * the function deliberately does not defend against planLength < 7.
 *
 * Uses local-noon Date parsing to avoid UTC-offset day rollback (same pattern as
 * WeekPlanService).
 */
export function computeFirstPlanPeriod(
  today: string,
  prefs: {
    default_plan_length_days: number;
    planning_trigger_offset: number;
    week_start_day: number;
  },
): { start: string; end: string } {
  const planLength = prefs.default_plan_length_days;
  const offset = prefs.planning_trigger_offset;
  const weekStartDay = prefs.week_start_day;

  // plan_start is tomorrow.
  const planStart = addDays(new Date(`${today}T12:00:00`), 1);

  // Anchor the window on the most recent week-start on or before plan_start.
  const daysSinceWeekStart = (planStart.getDay() - weekStartDay + 7) % 7;
  const currentPeriodStart = addDays(planStart, -daysSinceWeekStart);
  const nextPeriodStart = addDays(currentPeriodStart, planLength);
  const currentPeriodEnd = addDays(nextPeriodStart, -1); // inclusive end of plan_start's week

  // The next weekly-planning prompt fires `offset` days from the next period start.
  const firstTrigger = addDays(nextPeriodStart, offset);
  const daysUntilTrigger = Math.round(
    (firstTrigger.getTime() - planStart.getTime()) / 86_400_000,
  );

  // Most of the way through the current week → extend into the following week.
  // Both branches yield an end >= currentPeriodEnd, so no clamp is needed.
  const planEnd =
    daysUntilTrigger / planLength < 0.15
      ? addDays(nextPeriodStart, planLength - 1)
      : currentPeriodEnd;

  return { start: toISODate(planStart), end: toISODate(planEnd) };
}
```

- [ ] **Step 2: Run the spec to confirm it passes**

From `<worktree>/plnd_client`:

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/onboarding-state.service.spec.ts'`
Expected: PASS — all `computeFirstPlanPeriod`, `computeAndSetPlanPeriod`, and `planDays` cases green.

- [ ] **Step 3: Check for other callers and broken specs**

Confirm no other production caller or spec passes the old 2-field prefs shape to `computeFirstPlanPeriod`, and that `computeAndSetPlanPeriod` still type-checks (it passes the full `UserPreferences`, which already has `week_start_day`).

Run: `cd /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window && rg -n "computeFirstPlanPeriod" plnd_client/src`
Expected: only the definition + its callers in `onboarding-state.service.ts` and references in `onboarding-state.service.spec.ts`. No other call sites.

- [ ] **Step 4: Commit the implementation**

```bash
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window add plnd_client/src/app/features/onboarding/onboarding-state.service.ts
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window commit -m "fix(onboarding): start first plan tomorrow, align to week, revive roll-over

computeFirstPlanPeriod ignored week_start_day and rolled a fixed-length
window from today, leaving the 0.15 roll-over branch dead. Add week_start_day,
derive plan_start = tomorrow, week-align the end, and let the roll-over branch
fire when the next planning prompt is imminent. Fixes meal and task onboarding
via the shared planPeriod.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Document the first-window derivation in the architecture doc

**Files:**
- Modify: `docs/architecture.md` (§4.9 Planning windows)

- [ ] **Step 1: Add the first-window paragraph**

In §4.9, immediately after the paragraph beginning **"Onboarding's meal spoke surfaces the advance-planning toggle."** (and before the `### 4.10 The planning process` heading), insert a new blank line followed by:

```markdown
**The onboarding wizard's first window starts the day after onboarding.** A user finishing onboarding is not asked to plan a day already underway; the first plannable day is the day after they finish. From that start the window runs to the end of the user's current week — bounded by their chosen week-start day and plan length. When a user finishes late in their week, with little of it left to plan, the window instead extends through the following week, so the first plan is substantive rather than a one- or two-day stub. The recurring planning wizard carries no equivalent rule: it always plans a full window beginning on the next week-start and is future-dated by construction.
```

- [ ] **Step 2: Commit the doc change**

(Documentation-only — `just verify` is not required for this commit.)

```bash
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window add docs/architecture.md
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window commit -m "docs(architecture): describe onboarding first-window derivation (§4.9)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full pre-commit pipeline**

Run from the worktree root: `cd /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window && just verify`
Expected: PASS — quality + build + Angular unit + e2e all green.

- [ ] **Step 2: If any e2e hardcodes onboarding plan dates, fix expectations**

If an e2e spec asserts a specific onboarding meal/task plan date range, update it to the new tomorrow-start, week-aligned window (e.g. a fixed seeded "today" now yields a `plan_start` of the following day and a week-aligned `plan_end`). Re-run `just verify` until green. Commit any e2e fixes:

```bash
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window add plnd_client/e2e
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window commit -m "test(e2e): align onboarding plan-window expectations to tomorrow-start

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 3: Final review, rebase, and open the PR**

Run the requesting-code-review / final-review flow, then rebase onto `origin/main` and open the PR:

```bash
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window fetch origin
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window rebase origin/main
git -C /Users/robert/Development/plnd/.worktrees/fix/onboarding-first-window push --force-with-lease -u origin fix/onboarding-first-window
gh pr create --repo calteran/plnd --head fix/onboarding-first-window --base main \
  --title "fix(onboarding): start first plan tomorrow and align to the user's week" \
  --body "See docs/superpowers/specs/2026-06-11-onboarding-first-window-design.md"
```

Then invoke the `monitor-pr` skill.

---

## Notes for the implementer

- **Why both spokes are covered by one change:** the shared `planning-prefs-substep` calls `computeAndSetPlanPeriod`, setting a single `planPeriod` signal that both `/agent/meal-plan` (food spoke) and `/agent/place-tasks` (tasks spoke) read. There is no separate task-side window math.
- **Local-noon parsing matters:** dates are built as `new Date(\`${today}T12:00:00\`)` so that `addDays` + `toISODate` (which use local `getDate`/`getFullYear`) never roll back a day under a negative UTC offset. Keep this pattern; do not switch to `Date.parse` of a bare `YYYY-MM-DD` (parsed as UTC midnight).
- **Out of scope:** `main-layout.ts` (steady-state status window) is intentionally unchanged — it already plans the next full week and is future-dated.
