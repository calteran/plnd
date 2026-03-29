# E2E Test Design: Planning Wizard — Step 2 Tasks Planning

**Issue**: calteran/plnd#105
**Date**: 2026-03-29
**File to extend**: `plnd_client/e2e/tests/planning-wizard.e2e.ts`
**Component under test**: `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.ts`

---

## Overview

Extend the existing `planning-wizard.e2e.ts` with a `test.describe('Step 2 — Tasks Planning')` block covering the daily accordion UI, task rows, add/remove interactions, and the floating tasks panel.

---

## Setup

### Mock Data

**Scheduled tasks** (pre-seeded on `2026-03-30` only):
```ts
[
  { title: 'Morning run', energy: 'high', date: '2026-03-30', task_type: 'custom' },
  { title: 'Read book',   energy: 'low',  date: '2026-03-30', task_type: 'custom' },
]
```

All other horizon days (`2026-03-31` through `2026-04-05`) start empty.

**Floating tasks**: `[]`

### `beforeEach`

Each test uses `addInitScript` to inject a `plnd:plan-draft` into `localStorage` before Angular boots:

```ts
{
  schemaVersion: 1,
  planStart: '2026-03-30',
  planEnd: '2026-04-05',
  currentStep: 2,
  carryoverDecisions: {},
  scheduledMeals: {},
  scheduledTasks: [ /* two tasks on 2026-03-30 */ ],
  floatingTasks: [],
  savedAt: '2026-03-29T00:00:00.000Z',
}
```

Clock is fixed to `2026-03-28T00:00:00`. `seedWizard(page)` is called for API mocks. After `page.goto('/plan/week')`, wait for `.planning-wizard`, then assert `.progress-pill.active .pill-num` = `'2'` to confirm Step 2 is active.

---

## Test Scenarios

### 1. Accordion count
Assert `.day-accordion` count equals 7 (one per horizon day, Mon Mar 30 – Sun Apr 5).

### 2. Accordion header content
- First accordion (2026-03-30): day name = `MON`, date contains `Mar 30`, task badge = `2 tasks`
- Second accordion (2026-03-31): task badge = `0 tasks`

### 3. Accordion toggle (collapse then expand)
Since horizon ≤ 7, all accordions start expanded. On the first accordion:
- Click `.day-accordion__header` → accordion loses `.open` class (collapses)
- Click again → accordion regains `.open` class (expands)

### 4. Add task to a specific day
Target day `2026-03-31` (empty). Open the add form within that accordion:
- Click `.add-row` inside the day's `.add-affordance` to open the form
- Fill `.entry-input` with `"Walk the dog"`
- Click `.btn-add`
- Assert one `.task-row` appears in that day's `.day-accordion__body` with `.task-title` = `"Walk the dog"` and a `.energy-badge` visible

### 5. Task row content
On the pre-seeded first accordion (`2026-03-30`):
- Assert `.task-row` count = 2
- First row: `.task-title` = `"Morning run"`, `.energy-badge.energy-high` visible
- Second row: `.task-title` = `"Read book"`, `.energy-badge.energy-low` visible

### 6. Remove task
Click `.task-remove` on the first task row of `2026-03-30`:
- Assert `.task-row` count in that accordion drops to 1
- Remaining row `.task-title` = `"Read book"`

### 7. Floating panel renders
- `.floating-panel` is visible
- `.floating-title` contains text `"FLOATING TASKS"`
- `.floating-hint` is visible (contains "agent will schedule these")

### 8. Add floating task
In the `.float-add-affordance`:
- Click `.add-row` to open form
- Fill `.entry-input` with `"Buy groceries"`
- Click `.btn-add`
- Assert one `.floating-task-row` appears with `.task-title` = `"Buy groceries"` and `.floating-badge` visible

---

## Selectors Reference

| Element | Selector |
|---|---|
| Accordion container | `.day-accordion` |
| Accordion header | `.day-accordion__header` |
| Day name | `.day-name` |
| Day date | `.day-date` |
| Task count badge | `.task-badge` |
| Accordion body | `.day-accordion__body` |
| Task row | `.task-row` |
| Task title | `.task-title` |
| Energy badge | `.energy-badge.energy-{level}` |
| Remove button | `.task-remove` |
| Day add affordance | `.add-affordance` |
| Floating panel | `.floating-panel` |
| Floating title | `.floating-title` |
| Floating hint | `.floating-hint` |
| Floating task row | `.floating-task-row` |
| Floating badge | `.floating-badge` |
| Float add affordance | `.float-add-affordance` |
| Add entry closed | `.add-row` |
| Add entry input | `.entry-input` |
| Add button | `.btn-add` |

---

## Structure

```
test.describe('Step 2 — Tasks Planning', () => {
  test.beforeEach(...)          // inject draft, navigate, assert step 2 active

  test('daily accordions render one entry per horizon day', ...)
  test('accordion header shows day name, date, and task count badge', ...)
  test('clicking accordion header collapses and re-expands it', ...)
  test('adding a task to a day appends it to that day list', ...)
  test('task row shows title and energy level badge', ...)
  test('remove button removes a task from the day list', ...)
  test('floating tasks panel renders with floating title and hint', ...)
  test('adding a floating task appends it to the floating list', ...)
})
```

---

## Notes

- Energy badge for `'medium'` renders as `"med"` (per template: `task.energy === 'medium' ? 'med' : task.energy`)
- The `.open` class on `.day-accordion` controls both the chevron rotation and the max-height transition — it is the reliable selector for expanded state
- Scoping locators to a specific accordion uses `.day-accordion.nth(index)` to avoid cross-accordion interference
