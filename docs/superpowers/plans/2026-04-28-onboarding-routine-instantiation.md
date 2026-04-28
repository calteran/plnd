# Onboarding Routine Instantiation — Architectural Fix (Issue #599)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the onboarding week-preview architecture so that routine template instances are placed by the LLM as first-class, editable task entries. For date-constrained recurrences the LLM picks the time; for flexible recurrences the LLM picks the day and time. Users can edit or remove any placed instance before committing the plan.

**Architecture:** Three serially-dependent sub-issues. (1) Extend the backend agent endpoint to accept routine template data directly (not IDs — templates may not be in the DB yet during onboarding), expand them server-side, and pass instances to the LLM. (2) Refactor the frontend review step to pass template data to the agent and treat the unified response as a fully editable entry list. (3) Fix the onboarding hub commit to send `schedule_template_ids: []` — instances are now in `placed_tasks`, and templates are preserved in the DB for the weekly planning wizard.

**Tech Stack:** Rust/Axum (`plnd_api`, `plnd_agent`), Angular 18 signals, Markdown LLM prompt

---

## Context

Issue #599 asks for an Edit button on routine rows in `TaskPlacementReviewSubstepComponent`. The root cause is architectural: routine instances are expanded client-side for display only (`routineDisplayEntries`, `isRoutine: true`, `entryIndex: -1`), bypassing the LLM entirely. The LLM passively "knows" about routines via memory categories — it is never asked to actively schedule specific occurrences.

### Recurrence semantics

Instances fall into three categories based on how much freedom the LLM has:

| Recurrence rule | Date | LLM role |
|---|---|---|
| `FREQ=DAILY` | Fixed — one per calendar day in the window | Choose **time only** |
| `FREQ=WEEKLY;BYDAY=MO,WE,FR` | Fixed — one per matching weekday | Choose **time only** |
| `FREQ=WEEKLY` (no BYDAY) | Flexible — one occurrence somewhere in the week | Choose **day and time** |
| `FREQ=MONTHLY;...` — occurrence falls in window | Flexible — one occurrence in the window | Choose **day and time** |
| `FREQ=MONTHLY;...` — no occurrence in window | None — skip | N/A |
| `FREQ=YEARLY;...` — occurrence falls in window | Flexible — one occurrence in the window | Choose **day and time** |
| `FREQ=YEARLY;...` — no occurrence in window | None — skip | N/A |
| Unrecognised | None — skip | N/A |

**Pre-LLM classification logic** (runs server-side before the LLM call):
- For DAILY and WEEKLY+BYDAY: iterate the window, find all matching dates → emit one *constrained instance* per date (date is fixed)
- For bare WEEKLY: emit one *floating instance* per week window (date is flexible)
- For MONTHLY/YEARLY: evaluate whether any occurrence falls in the window (using RRULE computation or a probability threshold based on `window_days / recurrence_period_days`); if yes, emit one floating instance; if no, skip
  - Implementer note: a deterministic RRULE parse (e.g., `FREQ=MONTHLY;BYMONTHDAY=15` → check if the 15th is in the window) is preferred over pure probability; bare rules without a specific date can fall back to a probability check

The two instance types require different LLM instructions (see Sub-Issue 1 prompt changes).

### Why template data, not IDs

During onboarding the schedule_templates may not yet be persisted to the database. The full template objects are already available in the Angular state service (`stateService.scheduleTemplates()`), so the frontend can send the data it needs (title, recurrence_rule, task_type, duration, energy, time_window hint) directly in the request. No DB fetch is required in the agent endpoint.

### Template preservation

`schedule_templates` DB rows are NOT deleted or modified by this change. Once templates are persisted, the weekly planning wizard uses them in future `POST /schedule/plan` calls via `schedule_template_ids`. The onboarding commit sends `schedule_template_ids: []` because all instances for this week are in `placed_tasks`; the templates remain available for all subsequent weeks.

---

## Sub-Issue 1: Extend the place-tasks agent to expand and schedule routine templates

**GitHub title:** `feat(agent): extend place-tasks endpoint to accept routine template data and schedule instances via LLM`
**Depends on:** nothing (first in series)

### Problem
`POST /agent/place-tasks` only handles `task_names`. Routine templates are never part of the LLM placement call. The LLM cannot intelligently schedule routine instances alongside one-off tasks.

### Solution
Add `routine_templates: Vec<RoutineTemplateInput>` to `PlaceTasksRequest`. The route handler classifies each template into **constrained instances** (date fixed, LLM picks time) or **floating instances** (LLM picks day and time within the window) using existing RRULE logic extracted into a shared module. Both types are passed to the LLM via structured `prior_context` sections with different instructions. One-off tasks retain full scheduling freedom.

### Files
- Modify: `plnd_api/src/models.rs` — add `RoutineTemplateInput`; extend `PlaceTasksRequest`
- Add: `plnd_api/src/scheduling.rs` — shared RRULE expansion logic (extracted from `routes/schedule.rs`)
- Modify: `plnd_api/src/routes/schedule.rs` — call shared module instead of local function
- Modify: `plnd_api/src/routes/agent.rs` — expand templates, build prior context
- Modify: `plnd_agent/src/prompts/place_tasks.md` — instruct LLM on routine instance placement

### Detailed changes

**`plnd_api/src/models.rs`** — new struct; extend request:
```rust
/// Routine template data passed directly from the frontend (may not be in the DB yet).
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct RoutineTemplateInput {
    pub title: String,
    pub task_type: String,
    /// RRULE string: "FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,WE", "FREQ=MONTHLY;...", etc.
    pub recurrence_rule: String,
    pub duration_minutes: u32,
    pub energy_required: String,
    pub time_window_start: Option<String>, // "HH:MM" hint from template
    pub time_window_end: Option<String>,   // "HH:MM" hint from template
}

pub struct PlaceTasksRequest {
    pub task_names: Vec<String>,
    #[serde(default)]
    pub routine_templates: Vec<RoutineTemplateInput>, // NEW
    pub plan_start: NaiveDate,
    pub plan_end: NaiveDate,
}
```

**`plnd_api/src/scheduling.rs`** — extract and expose two pure classification functions (currently private in `routes/schedule.rs`):
```rust
/// Returns all dates in [start, end] where this rule produces a constrained instance
/// (date is deterministic). Covers FREQ=DAILY and FREQ=WEEKLY;BYDAY=...
/// Returns empty vec for rules that require LLM to choose the date.
pub fn constrained_dates_for_rule(rule: &str, start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate>

/// Returns true if this rule should produce exactly one floating instance somewhere
/// in [start, end] — i.e., the LLM must choose the day as well as the time.
/// Covers bare FREQ=WEEKLY (no BYDAY), FREQ=MONTHLY whose occurrence falls in the window,
/// FREQ=YEARLY whose occurrence falls in the window.
/// For rules without a deterministic occurrence date, use window_days/period_days probability.
pub fn has_floating_instance_in_window(rule: &str, start: NaiveDate, end: NaiveDate) -> bool
```

Update `routes/schedule.rs` to call these instead of the local versions.

**`plnd_api/src/routes/agent.rs`** — classify templates, build two-section `prior_context`:
```rust
let mut constrained_lines: Vec<String> = Vec::new();
let mut floating_lines: Vec<String>    = Vec::new();

for t in &body.routine_templates {
    let window_hint = match (&t.time_window_start, &t.time_window_end) {
        (Some(s), Some(e)) => format!(" preferred window {s}–{e}"),
        (Some(s), None)    => format!(" preferred start {s}"),
        _                  => String::new(),
    };
    let desc = format!(
        "- \"{}\" ({}, {} min, {} energy){}",
        t.title, t.task_type, t.duration_minutes, t.energy_required, window_hint,
    );

    let dates = crate::scheduling::constrained_dates_for_rule(
        &t.recurrence_rule, body.plan_start, body.plan_end,
    );
    if !dates.is_empty() {
        for date in dates {
            constrained_lines.push(format!("{desc} on {date}"));
        }
    } else if crate::scheduling::has_floating_instance_in_window(
        &t.recurrence_rule, body.plan_start, body.plan_end,
    ) {
        floating_lines.push(desc);
    }
    // Otherwise: no occurrence in this window — skip
}

let mut routine_context = String::new();
if !constrained_lines.is_empty() {
    routine_context.push_str(
        "[Routine instances with fixed dates — keep the date, you choose the time]\n"
    );
    routine_context.push_str(&constrained_lines.join("\n"));
    routine_context.push('\n');
}
if !floating_lines.is_empty() {
    routine_context.push_str(&format!(
        "[Routine instances to place once in the window {} through {} — you choose the day and time]\n",
        body.plan_start, body.plan_end,
    ));
    routine_context.push_str(&floating_lines.join("\n"));
    routine_context.push('\n');
}

let ctx = AgentContext {
    user_id,
    use_case: UseCase::PlaceTasks,
    input: body.task_names.join("\n"),
    prior_context: Some(format!(
        "{routine_context}[Period: {plan_start} through {plan_end}]\n"
    )),
    extra: None,
};
```

Note: if `task_names` is empty but instances were generated, `ctx.input` is an empty string. The prompt update below handles this.

**`plnd_agent/src/prompts/place_tasks.md`** — add after the core workflow, before output rules:
```markdown
## Routine instances

### Fixed-date instances
When `[Routine instances with fixed dates ...]` appears in the prior context, each line
lists a recurring task with a **pre-assigned date** — do not change the date. Choose
an appropriate time of day, considering the user's energy pattern and schedule memories.
Set `scheduled_date` to the pre-assigned date and use `time_window_start` for the time.

### Floating instances
When `[Routine instances to place once in the window ...]` appears in the prior context,
each line is a recurring task with **no fixed date** — choose both the day and the time
within the specified window. Place it where it best fits given the user's energy and
other tasks.

Include every listed routine instance (fixed and floating) in your output using the
same `place_tasks` tool format as one-off tasks. If `<user_input>` is empty, your
output should consist entirely of the routine instances from the prior context.
```

**Tests:**
- `PlaceTasksRequest` with empty `routine_templates` behaves identically to the current API
- DAILY template over a 3-day window → 3 constrained instance lines in `prior_context`
- WEEKLY+BYDAY template → correct matching-weekday lines in constrained section
- Bare WEEKLY template → one line in floating section
- MONTHLY template with no occurrence in window → neither section contains it
- MONTHLY template with occurrence in window → one line in floating section
- Route handler with no `task_names` but with instances produces valid agent call

### Acceptance criteria
- `constrained_dates_for_rule()` and `has_floating_instance_in_window()` cover all cases in the recurrence table
- Existing `place-tasks` callers without `routine_templates` are unaffected
- `prior_context` contains correctly sectioned instance lines
- `just verify` passes (Rust side)

---

## Sub-Issue 2: Pass routine template data to the agent; remove routineDisplayEntries from review step

**GitHub title:** `fix(onboarding): pass routine templates to agent and unify editable entries in week preview`
**Depends on:** Sub-Issue 1 merged

### Problem
The frontend expands templates client-side in `expandTemplatesToEntries()` (handles only DAILY/WEEKLY), populates a separate `routineDisplayEntries` signal, and renders those rows as display-only. After Sub-Issue 1 the backend handles all recurrence types, so client-side expansion is redundant and client-side display-only treatment is wrong.

### Solution
Pass `routine_templates` (mapped from `stateService.scheduleTemplates()`) in the `PlaceTasksRequest`. The agent returns all placed entries (routine instances + one-off tasks) as a unified response. Remove `routineDisplayEntries`, `isRoutine`, and `entryIndex: -1`. All entries get real indices and the Edit button.

### Files
- Modify: `plnd_client/src/app/core/models/week-plan.ts`
- Modify: `plnd_client/src/app/features/onboarding/tasks/substeps/task-placement-review-substep/task-placement-review-substep.ts`
- Modify: `plnd_client/src/app/features/onboarding/tasks/substeps/task-placement-review-substep/task-placement-review-substep.spec.ts`

### Detailed changes

**`week-plan.ts`** — add `RoutineTemplateInput`; extend `PlaceTasksRequest`:
```typescript
export interface RoutineTemplateInput {
  title: string;
  task_type: string;
  recurrence_rule: string;
  duration_minutes: number;
  energy_required: EnergyLevel;
  time_window_start?: string; // "HH:MM"
  time_window_end?: string;   // "HH:MM"
}

export interface PlaceTasksRequest {
  task_names: string[];
  routine_templates: RoutineTemplateInput[]; // NEW
  plan_start: string;
  plan_end: string;
}
```

**`task-placement-review-substep.ts`:**

Remove `expandTemplatesToEntries()` entirely (client-side expansion is now server-side).

`TaskRow` — remove `isRoutine`:
```typescript
interface TaskRow {
  kind: 'task';
  entry: PlaceTasksEntry;
  entryIndex: number; // always a real index into entries[]
}
```

`buildDayCards()` — single unified entries array; remove `routineEntries` param and `entryIndex: isRoutine ? -1 : idx`:
```typescript
function buildDayCards(entries: PlaceTasksEntry[], start: string, end: string): DayCard[]
```

`loadPlacement()` — new flow:
```typescript
loadPlacement(): void {
  if (this.isLoading()) return;

  const taskNames = this.stateService.upcomingTaskNames();
  const period = this.stateService.planPeriod();
  if (!period) return;

  const routineTemplates: RoutineTemplateInput[] = this.stateService.scheduleTemplates()
    .map(t => ({
      title: t.title,
      task_type: t.task_type,
      recurrence_rule: t.recurrence_rule ?? '',
      duration_minutes: t.duration_minutes ?? 30,
      energy_required: t.energy_required,
      time_window_start: t.time_window_start ?? undefined,
      time_window_end: t.time_window_end ?? undefined,
    }));

  this.loadingTaskNames.set(taskNames);
  this.loadingRoutineCount.set(routineTemplates.length);
  this.isLoading.set(true);
  this.hasError.set(false);
  this.editState.set(null);

  const body: PlaceTasksRequest = {
    task_names: taskNames,
    routine_templates: routineTemplates,
    plan_start: period.start,
    plan_end: period.end,
  };

  this.agentService.placeTasks(body)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe({
      next: (result) => {
        this.entries.set(result);
        this.dayCards.set(buildDayCards(result, period.start, period.end));
        this.isLoading.set(false);
      },
      error: () => {
        this.hasError.set(true);
        this.isLoading.set(false);
      },
    });
}
```

Note: the early "no agent call for routines-only" path is removed. The agent is always called — even for routines-only scenarios the LLM picks times. The `isEmpty()` guard (no tasks AND no templates) still prevents the call when truly empty.

Remove `routineDisplayEntries` signal declaration and all references. Update `saveEdit()` and `removeEntry()` to pass only `this.entries()` as the single argument to `buildDayCards()`.

Template — two removals:
- Delete `@if (!row.isRoutine)` wrapper around the Edit button
- Delete `[class.task-row--routine]="row.isRoutine"` binding

`rowTrack()` — simplify:
```typescript
rowTrack(row: DayRow): string {
  if (row.kind === 'meal') return `meal-${row.label}`;
  return `task-${row.entryIndex}`;
}
```

CSS — delete `.task-row--routine { opacity: 0.85; }` and the entire `.routine-badge { ... }` block.

**`task-placement-review-substep.spec.ts`:**
- Remove the direct `expandTemplatesToEntries` import and its test suite (function removed)
- "Routines-only" test: expect an HTTP call to `place-tasks`; flush with LLM-placed entries; expect Edit buttons visible
- "Mixed" test: HTTP response includes both routine + one-off entries; all rows have Edit buttons
- "Save & Return" routines-only: `setPlacedTasks` receives LLM-placed entries (not `[]`)
- "Save & Return" mixed: `placed_tasks` includes both routine and one-off entries
- Add test: open Edit on any row, mutate date/time/duration/energy, save — `entries` updated, `dayCards` rebuilt
- Add test: remove an entry — entry removed, remaining indices stable, `dayCards` rebuilt

### Acceptance criteria
- All rows in the week preview have an Edit button
- Routines-only scenario: loading screen appears; agent call made; results shown
- Editing or removing any entry works identically regardless of origin
- `setPlacedTasks` receives all entries on Save & Return
- `just verify` passes (Angular side)

---

## Sub-Issue 3: Omit schedule_template_ids from onboarding plan commit

**GitHub title:** `fix(onboarding): omit schedule_template_ids from plan commit — instances are already in placed_tasks`
**Depends on:** Sub-Issue 2 merged

### Problem
After Sub-Issue 2, all routine instances (for all recurrence types that fire in the plan window) are in `placed_tasks`. However `commitPlan()` still sends all template IDs in `schedule_template_ids`, causing the backend to expand them a second time and create duplicate `schedule_entries`.

Templates are NOT deleted — they remain in `schedule_templates` for the weekly planning wizard.

### Solution
One-line change: `schedule_template_ids: []` in the onboarding commit.

### Files
- Modify: `plnd_client/src/app/features/onboarding/hub/onboarding-hub.ts`
- Modify (if commit tests exist): `plnd_client/src/app/features/onboarding/hub/onboarding-hub.spec.ts`

### Detailed change

In `commitPlan()`:
```typescript
// Before:
schedule_template_ids: this.onboardingState.scheduleTemplates().map(t => t.template_id),

// After:
schedule_template_ids: [],
```

**Tests:**
- `commitPlan()` sends `schedule_template_ids: []` regardless of how many templates exist in state
- Templates in `schedule_templates` table are unaffected

### Acceptance criteria
- No duplicate `schedule_entries` after onboarding commit
- `schedule_templates` DB rows untouched
- `just verify` passes

---

## Verification (end-to-end, after all three sub-issues merged)

1. `just dev` — start full stack
2. Navigate through onboarding; add a DAILY routine "Medication", a WEEKLY (Mon/Wed/Fri) routine "Morning Walk", and one-off task "Doctor Appointment"
3. Reach week preview: loading screen appears (agent call in progress for all items)
4. Once loaded: all rows have Edit buttons; LLM-chosen times visible
5. Edit Monday's "Medication" — change time to 09:00; verify grid updates
6. Remove Tuesday's "Medication"; verify it disappears
7. Save & Return; complete remaining onboarding sections and approve plan
8. Inspect committed `schedule_entries`:
   - "Medication" on Mon/Wed–Sun at LLM-chosen times (Mon at 09:00; Tue absent)
   - "Morning Walk" on Mon/Wed/Fri at LLM-chosen times
   - "Doctor Appointment" on LLM-chosen date and time
   - No duplicates on any day
9. Confirm `schedule_templates` still contains both routine rows

---

## Notes
- The weekly planning wizard has the same `routineDisplayEntries` pattern; open a follow-up issue after this work lands
- No DB schema changes; no new migrations
- The `recurrence_rule` field on `RoutineTemplateInput` uses RRULE strings (`FREQ=DAILY`, `FREQ=WEEKLY;BYDAY=...`), which maps directly to the existing `date_matches_recurrence()` backend logic
