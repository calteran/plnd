# Weekly Planning Wizard — Design Spec

**Date**: 2026-03-23
**Phase**: 2.5
**Status**: Approved for implementation planning

---

## Context

PLND is a neurodivergent-focused planner where structure and predictability reduce cognitive overhead. The weekly planning wizard gives users one dedicated "thinking session" per week (or per custom horizon) where they review what's carried over, schedule meals and tasks, and confirm the full plan before committing it. This replaces the cognitive load of constant ad-hoc scheduling decisions throughout the week.

The planning todo appears in the day view like any other task. Completing the wizard marks it done. Users can re-plan at any time via the sidebar.

---

## Decision Summary

| Dimension | Decision |
|---|---|
| Wizard container | Full-page route — `/plan/week` replaces content while header + sidebar remain |
| Planning horizon | Flexible: `plan_start_date` + `plan_end_date`, not fixed 7 days |
| Horizon defaults | User-configurable: start day, plan length, trigger day (stored in `user_preferences`) |
| Meal suggestions | Hardcoded stubs from user's library (Phase 3 LLM slot) |
| Day review UI | 7-day grid on desktop; horizontal swipe cards on mobile |
| Re-plan scope | Skip past days — wizard only shows today + future days in horizon |
| Planning task | Regular `task_type='custom'` task with `category='weekly_plan'` in day view |
| State management | Session-first: Angular signals + localStorage persistence; optional server-side JSON draft |
| Step order | Review → Tasks & Exercise → Meals → Day Review → Confirm |

---

## Wizard Steps

### Step 1 — Review (Carry-over)
- Shows any tasks from the previous planning horizon that were not completed
- User can: **Defer** (push to this horizon), **Dismiss** (mark as skipped), or **Accept** (include as-is)
- Also shows the horizon date range with a date-range picker to adjust: "Planning [Mon Mar 24] → [Sun Mar 30] — change?"
- Auto-defaults: start = next occurrence of configured plan start day, end = start + `default_plan_length_days - 1`

### Step 2 — Tasks & Exercise
- Pre-populates from `schedule_templates` with `recurrence` matching the horizon days
- User adds one-off tasks or exercise sessions for any day in the horizon
- Each task carries `energy_required` (low/medium/high) — displayed as a color indicator
- No AI balancing in Phase 2.5; energy display is informational only

### Step 3 — Meals
- For each day × slot (Breakfast, Lunch, Dinner, optional Snack):
  - Shows a stub-suggested meal drawn from the user's `user_meals` library (hardcoded rotation logic)
  - User can: **Accept**, **Swap** (pick from library), or **Skip** (leave slot empty)
- Dietary restrictions are respected in stub filtering
- LLM suggestion slot is intentionally left empty with a placeholder comment for Phase 3

### Step 4 — Day Review
- **Desktop**: 7-day (or N-day) grid — one card per day showing meal summary + task count
  - Click a card to expand it inline (accordion) for editing
  - Grid scrolls horizontally if horizon > 7 days
- **Mobile**: Horizontal swipe cards — one day at a time, swipe left/right to navigate
  - Day header shows date + day-of-week
  - Tap to expand meal/task details
- "Add item" affordance per day for quick additions without leaving the step

### Step 5 — Confirm
- Summary: total days planned, meal coverage %, task count, unplanned slots highlighted
- "Finish Week Plan" button:
  1. Calls `POST /schedule/plan` with all entries
  2. Marks the `weekly_plan` task as `completed`
  3. Clears localStorage draft
  4. Navigates to the day view for the first day of the horizon
- "Cancel" link returns to wherever the user came from (day view or sidebar entry point)

---

## Data Model

### `user_preferences` — new columns

```sql
ALTER TABLE user_preferences
  ADD COLUMN week_start_day    SMALLINT NOT NULL DEFAULT 1,  -- 0=Sun ... 6=Sat
  ADD COLUMN planning_trigger_day SMALLINT NOT NULL DEFAULT 0, -- day the task appears (0=same as week_start_day is handled in app logic)
  ADD COLUMN default_plan_length_days SMALLINT NOT NULL DEFAULT 7;

-- CHECK constraints:
-- week_start_day BETWEEN 0 AND 6
-- planning_trigger_day BETWEEN 0 AND 6
-- default_plan_length_days BETWEEN 1 AND 90
```

### Planning Task Auto-creation

When a user loads the day view on or after `planning_trigger_day` and no `weekly_plan` task exists for the current horizon:
- Frontend checks `WeekPlanService.hasActivePlanTask()` (signal, loaded on auth)
- If absent, calls `POST /tasks/weekly-plan` to auto-create a `generic_tasks` row:
  - `task_type = 'custom'`, `category = 'weekly_plan'`
  - `scheduled_start` = start of the current planning horizon
  - `title = 'Plan your week'`
- Appears in the day view like any other task on `planning_trigger_day`

### Optional: `week_plan_drafts`

```sql
CREATE TABLE week_plan_drafts (
  user_id     UUID REFERENCES users(user_id) ON DELETE CASCADE,
  plan_start  DATE NOT NULL,
  draft       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, plan_start)
);
```

Deferred to Phase 3 unless early feedback shows localStorage-only recovery is insufficient.

---

## Backend Endpoints

### `GET /schedule/period`

**Query params**: `start=2026-03-24&end=2026-03-30`

Returns existing `schedule_entries` for the period (for the Review and Day Review steps). Response shape:
```json
{
  "entries": [ /* ScheduleEntry[] */ ],
  "carryover": [ /* incomplete tasks from previous horizon */ ]
}
```

### `POST /schedule/plan`

Batch-creates schedule entries for all days in the horizon and marks the planning task complete.

```json
{
  "plan_start": "2026-03-24",
  "plan_end": "2026-03-30",
  "planning_task_id": "<uuid>",
  "entries": [
    {
      "date": "2026-03-24",
      "task_type": "meal",
      "task_ref_id": "<user_meal_id>",
      "task_ref_type": "user_meal",
      "scheduled_start": "08:00",
      "after_milepost": "breakfast"
    }
    // ...
  ]
}
```

Returns: `{ "committed": <count>, "planning_task": { "status": "completed" } }`

### `PUT /schedule/plan/draft` *(optional, Phase 3)*

Upserts a JSON blob to `week_plan_drafts`. Called after each step transition if server-side draft is enabled. Body: `{ plan_start, draft: <json> }`.

### `POST /tasks/weekly-plan`

Auto-creates the `weekly_plan` generic task for the horizon if none exists. Idempotent — no-op if a task already exists for the `plan_start`. Returns the task.

---

## Angular Components

**New directory**: `plnd_client/src/app/features/planning/`

| File | Role |
|---|---|
| `planning-wizard/planning-wizard.ts` | Root wizard — step routing, progress bar, Back/Next navigation, draft lifecycle |
| `steps/plan-review-step/plan-review-step.ts` | Carry-over task list + horizon date range adjuster |
| `steps/plan-tasks-step/plan-tasks-step.ts` | Recurring template pre-fill + one-off task/exercise adder |
| `steps/plan-meals-step/plan-meals-step.ts` | Meal slot picker with stub suggestions |
| `steps/plan-day-grid-step/plan-day-grid-step.ts` | Responsive day grid (desktop) / swipe cards (mobile) |
| `steps/plan-day-grid-step/plan-day-card.ts` | Individual day card — summary + inline expand |
| `steps/plan-confirm-step/plan-confirm-step.ts` | Final summary + Finish button |

**New service**: `plnd_client/src/app/core/services/week-plan.service.ts`

Signals:
- `planStart: Signal<string>` (ISO date)
- `planEnd: Signal<string>` (ISO date)
- `currentStep: Signal<number>` (1–5)
- `carryoverItems: Signal<CarryoverItem[]>`
- `scheduledTasks: Signal<PlannedTask[]>`
- `scheduledMeals: Signal<PlannedMeal[]>` (keyed by date + slot)
- `isSubmitting: Signal<boolean>`

Methods:
- `initSession(start, end)` — sets horizon, loads draft from localStorage
- `saveDraft()` — writes to `localStorage` key `plnd:plan-draft`
- `loadDraft()` — reads and validates from localStorage
- `commitPlan()` — calls `POST /schedule/plan`, clears draft
- `clearDraft()` — on cancel
- `hasActivePlanTask()` — checks for existing `weekly_plan` task this horizon

**localStorage draft shape**:
```json
{
  "schemaVersion": 1,
  "planStart": "2026-03-24",
  "planEnd": "2026-03-30",
  "currentStep": 2,
  "carryoverDecisions": { "<taskId>": "defer|dismiss|accept" },
  "scheduledMeals": {
    "2026-03-24": { "breakfast": { "type": "user_meal", "id": "<uuid>", "title": "Oatmeal" } }
  },
  "scheduledTasks": [ { "date": "2026-03-24", "title": "Morning walk", "duration": 30, "energy": "low" } ],
  "savedAt": "2026-03-23T14:32:00Z"
}
```

---

## Routing

```typescript
// app.routes.ts addition (inside authenticated + onboarding-complete children)
{
  path: 'plan',
  children: [
    { path: 'week', component: PlanningWizardComponent },
    { path: '', redirectTo: 'week', pathMatch: 'full' }
  ]
}
```

---

## Sidebar Changes

`main-layout.html` — add nav item:

```html
<a routerLink="/plan/week" routerLinkActive="active" class="sidebar-item">
  <span class="sidebar-icon" aria-hidden="true">📋</span>
  <span class="sidebar-label">Plan Week</span>
  @if (weekPlanService.hasUnplannedHorizon()) {
    <span class="sidebar-badge" aria-label="Week not yet planned"></span>
  }
</a>
```

Mobile bottom tab: add "Plan" tab alongside "Today".

---

## Settings Page Changes

Add two fields to `settings.ts`:
1. **Week starts on** — `<select>` for `week_start_day` (Sun/Mon/Tue…)
2. **Plan horizon length** — numeric input for `default_plan_length_days` (default 7, min 1, max 90)

Wired to `preferences.service.ts` via `PATCH /preferences/me`.

---

## Re-plan Behavior

When the user clicks "Plan Week" from the sidebar and a committed plan already exists:
1. Load existing entries for the remaining horizon (today → `plan_end`)
2. Wizard starts at Step 1 (Review) but carry-over section is replaced with "Existing plan for remaining days"
3. Past days are excluded — wizard only covers today and forward
4. On Finish: `POST /schedule/plan` with `replace: true` replaces entries for unstarted days only

---

## Out of Scope for Phase 2.5

- LLM-powered meal suggestions (Phase 3)
- Saved named plan configurations ("Travel mode")
- Family-coordinated planning (Family Support phase)
- Server-side draft caching (`week_plan_drafts` table)
- Grocery list generation from the week's meals (Phase 4)
- Calendar sync (Phase 4)

---

## Verification

End-to-end test flow:
1. Load app as authenticated, onboarded user
2. Navigate to the day view on `planning_trigger_day` — confirm "Plan your week" task appears
3. Tap the task → wizard loads at `/plan/week`, Step 1 shows
4. Adjust horizon dates → step persists updated range throughout wizard
5. Complete all 5 steps — confirm localStorage draft is written after each step
6. Click "Finish Week Plan" → `POST /schedule/plan` fires, planning task marked complete, navigates to day view
7. Navigate to `/plan/week` again → wizard detects existing plan, loads re-plan mode (past days skipped)
8. Sidebar "Plan Week" item shows badge when horizon is unplanned; badge clears after commit
9. Settings page → change `week_start_day` → new planning sessions respect the updated default
10. Crash recovery: fill steps 1–3, close browser, reopen → wizard resumes from localStorage at step 3
