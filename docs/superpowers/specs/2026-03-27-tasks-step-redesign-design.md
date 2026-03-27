# Tasks & Exercise Step Redesign — Design Spec

**Issue:** calteran/plnd#60 — fix(planning): redesign tasks & exercise step layout (#48.3)
**Date:** 2026-03-27
**Scope:** `plan-tasks-step.ts`, `week-plan.ts` (model + service), `plan-tasks-step.spec.ts`

---

## Problem

`PlanTasksStepComponent` has three layout deficiencies:

1. **Per-day sections** are flat `h3 + ul` — no visual card separation between days
2. **Add-task form** is a global flex-row at the bottom requiring an explicit day picker; it doesn't match the app's morphing free-text entry pattern from `AddEntryComponent`
3. **No support for floating tasks** — tasks the user wants to note without assigning to a specific day, to be scheduled by the agent

---

## Design

### 1. Per-day accordion sections

Each day in `horizonDays` renders as a rounded card accordion.

**Card shell:**
- `background: var(--color-surface-white)`, `border: 1.5px solid var(--color-border-row)`, `border-radius: 10px`
- Expanded state: `border-color: var(--color-accent)`
- CSS `max-height` transition for expand/collapse (same technique as `plan-day-card`)

**Header band:**
- Background: `var(--color-surface-warm)`, bottom border: `1.5px solid var(--color-border-meal)`
- Expanded: `var(--color-accent-light)` background, `var(--color-accent-border)` bottom border
- Content: day name (uppercase, 11px, 800w; shifts to `var(--color-accent-dark)` when expanded), short date (10px muted), task count badge (amber non-zero / grey zero), chevron `▾` (rotates 180° on expand)
- Click anywhere on header to toggle

**Expand default:**
```ts
expanded = this.horizonDays().length <= 7;
```
Evaluated once per section on init. User can toggle freely at any time.

**Task rows:**
- Task title (12px), energy badge (`--color-energy-low/medium/high` tokens, derived from task data — not entered by user in this flow), remove `✕` button right-aligned
- Rows separated by `1px solid var(--color-border-row)`, last row no border

**Add affordance (bottom of expanded body):**
- Dashed top border separates it from task list
- Collapsed by default: `+ Add something…` row (14×14px rounded box icon + 12px muted label)
- Expands to `<app-add-entry>` on click — full morphing free-text entry (exercise → duration, appointment → time + location)
- On `(added)` output, step adapts `AddedEntry → PlannedTask` and calls `weekPlanService.addTask()`

### 2. Floating tasks panel

A separate panel below all day-accordion sections.

**Card shell:**
- Same rounded card but with violet border: `var(--color-purple-border)` (`#c4b5fd`)
- Header background: `var(--color-purple-light)` (`#f5f3ff`)

**Header:**
- Label: "FLOATING TASKS" (uppercase, 11px, 800w, `var(--color-purple-dark)`)
- Right: italic hint "agent will schedule these" (10px, `var(--color-purple)`)

**Task rows:**
- Title + `floating` badge (violet scheme) + remove `✕`

**Add affordance:**
- Same `+ Add something…` pattern, violet-tinted
- On `(added)`, step calls `weekPlanService.addFloatingTask()`

### 3. `AddEntryComponent` integration

`AddEntryComponent` is used as-is with no modifications. `plan-tasks-step` renders one instance per expanded day section and one inside the floating panel. Adapter logic lives in the step:

```ts
onTaskAdded(date: string, entry: AddedEntry): void {
  this.weekPlanService.addTask({
    date,
    title: entry.label,
    energy: 'medium',            // stub — agent refines later
    duration: entry.duration,
    task_type: entry.type === 'exercise' ? 'exercise' : 'custom',
  });
}

onFloatingTaskAdded(entry: AddedEntry): void {
  this.weekPlanService.addFloatingTask({
    title: entry.label,
    energy: 'medium',
    duration: entry.duration,
    task_type: entry.type === 'exercise' ? 'exercise' : 'custom',
  });
}
```

`energy: 'medium'` is a placeholder. The user never sees or sets energy in this flow — it is inferred by the agent at scheduling time.

---

## Data Model Changes

### `week-plan.ts`

Add `FloatingTask` type alias:

```ts
export type FloatingTask = Omit<PlannedTask, 'date'>;
```

`PlannedTask` is unchanged (`date` remains required).

### `WeekPlanService`

Add to the service:

```ts
readonly floatingTasks = signal<FloatingTask[]>([]);

addFloatingTask(task: FloatingTask): void {
  this.floatingTasks.update(tasks => [...tasks, task]);
}

removeFloatingTask(index: number): void {
  this.floatingTasks.update(tasks => tasks.filter((_, i) => i !== index));
}
```

`clearDraft()` also clears `floatingTasks`:
```ts
this.floatingTasks.set([]);
```

### Color tokens

Four new tokens required in `_tokens.scss` (light theme; dark-mode variants deferred — see Out of Scope):

| Token | Light value | Purpose |
|---|---|---|
| `--color-purple` | `#7c3aed` | Floating panel hint text, add affordance |
| `--color-purple-light` | `#f5f3ff` | Floating panel header background |
| `--color-purple-border` | `#c4b5fd` | Floating panel border, badge border |
| `--color-purple-dark` | `#4c1d95` | Floating panel header label, badge text |

---

## Files Changed

| File | Change |
|---|---|
| `plnd_client/src/styles/_tokens.scss` | Add 4 purple tokens (light + dark variants) |
| `plnd_client/src/app/core/models/week-plan.ts` | Add `FloatingTask` type alias |
| `plnd_client/src/app/core/services/week-plan.service.ts` | Add `floatingTasks` signal + `addFloatingTask()` + `removeFloatingTask()`; update `clearDraft()` |
| `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.ts` | Rewrite template + styles; import `AddEntryComponent`; add adapter methods; `horizonDays` becomes `computed()`; drop `ngOnInit` |
| `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.spec.ts` | Update tests for new template; add floating task tests |

No new component files. `AddEntryComponent` is untouched.

---

## Out of Scope

- Dark-mode variants for purple tokens (follow existing dark-mode pattern, deferred)
- Drag-to-assign floating tasks to a day (deferred to calteran/plnd#65)
- Agent scheduling logic (backend concern)
- Duration field for floating tasks beyond what `AddEntryComponent` provides for exercise entries
