# Keyboard/Button Reorder Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-drag (focus-revealed button) reorder path for tasks across the day view and both planning wizards, covering the same four gestures drag covers (within slot, between slots, into/out of a meal pairing, cross-day).

**Architecture:** Two shared units — a pure `reorder-navigation.ts` helper that computes where an "earlier/later" step lands (including slot/meal/day-edge boundary crossings) and a presentational `ReorderControlsComponent` (↑/↓ and, in the wizards, «/» buttons, hidden until the row has focus). Each surface maps its existing assembly into the helper's normalized layout, dispatches the result to its **existing** move operation (`repositionTask` / `entries` signal mutation / `reorderTask`+`updateTaskSlot`), and owns focus-follows-task plus a `LiveAnnouncer` announcement. No backend changes.

**Tech Stack:** Angular (standalone, signals, OnPush), `@angular/cdk/a11y` `LiveAnnouncer` (CDK already a dependency), Vitest unit tests, Playwright e2e against the real backend.

## Global Constraints

- **Angular components are standalone + `ChangeDetectionStrategy.OnPush`.** Test OnPush components by dispatching real DOM events, never direct field writes.
- **Angular test providers:** use `provideHttpClient()` + `provideHttpClientTesting()` + `provideRouter([])` — never `HttpClientTestingModule`/`RouterTestingModule`.
- **Tests run from the worktree:** `cd plnd_client` then `npx ng test --watch=false` (Vitest builder). Do NOT use `just test-ng-headless` (runs the main checkout).
- **E2E files MUST be named `*.e2e.ts`** — Playwright's `testMatch` only collects that suffix; `*.spec.ts` in `e2e/` silently never runs.
- **E2E mock policy:** schedule endpoints are served by the real backend; only agent endpoints (`/agent/*`) may be mocked. Seed via real API helpers (`seedAuth`, `seedOnboarding`, `seedScheduleEntries`).
- **No backend changes.** A keyboard move emits the same `(slot key, position)` a drop emits; persistence (`PATCH /schedule/entries/{id}/position`) and the commit payload are unchanged.
- **Pre-commit validation:** run `just verify` bare (never piped) before each PR; redirect to a file with `> log 2>&1` if capturing. Docs-only steps are exempt.
- **Branch discipline:** each phase is its own PR against `main`; rebase onto `origin/main` before pushing.
- **No anchors move.** Only floating/paired tasks reorder; meal rows and scheduled-task rows are never moved.

---

# Phase 1 — Shared primitives + day view (PR 1)

## Task 1: Pure navigation helper `reorder-navigation.ts`

**Files:**
- Create: `plnd_client/src/app/core/utils/reorder-navigation.ts`
- Test: `plnd_client/src/app/core/utils/reorder-navigation.spec.ts`

**Interfaces:**
- Produces:
  - `type SlotKind = 'slot' | 'meal'`
  - `interface DaySlot { slotKey: string; kind: SlotKind; taskIds: string[] }`
  - `type DayLayout = DaySlot[]`
  - `type Crossing = 'same-slot' | 'to-slot' | 'into-meal' | 'out-of-meal'`
  - `interface MoveResult { slotKey: string; kind: SlotKind; index: number; crossing: Crossing }`
  - `stepWithinDay(layout: DayLayout, taskId: string, dir: 'up' | 'down'): MoveResult | null`
  - `resolveDayJump(currentSlotKey: string, targetDaySlotKeys: string[]): string`
  - `describeMove(p: { crossing: Crossing; dir: 'up' | 'down'; targetLabel?: string; sourceLabel?: string }): string`
  - `describeDayJump(p: { dayLabel: string; targetLabel?: string }): string`

- [ ] **Step 1: Write the failing tests**

Create `plnd_client/src/app/core/utils/reorder-navigation.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  stepWithinDay, resolveDayJump, describeMove, describeDayJump, DayLayout,
} from './reorder-navigation';

const layout: DayLayout = [
  { slotKey: 'start of day', kind: 'slot', taskIds: ['a', 'b'] },
  { slotKey: 'meal-1',       kind: 'meal', taskIds: [] },          // empty pairing
  { slotKey: 'breakfast',    kind: 'slot', taskIds: ['c'] },
];

describe('stepWithinDay', () => {
  it('reorders within a slot (down)', () => {
    expect(stepWithinDay(layout, 'a', 'down'))
      .toEqual({ slotKey: 'start of day', kind: 'slot', index: 1, crossing: 'same-slot' });
  });

  it('reorders within a slot (up)', () => {
    expect(stepWithinDay(layout, 'b', 'up'))
      .toEqual({ slotKey: 'start of day', kind: 'slot', index: 0, crossing: 'same-slot' });
  });

  it('returns null at the very first position (up)', () => {
    expect(stepWithinDay(layout, 'a', 'up')).toBeNull();
  });

  it('returns null at the very last position (down)', () => {
    expect(stepWithinDay(layout, 'c', 'down')).toBeNull();
  });

  it('steps down out of the bottom of a slot into an empty meal pairing (into-meal)', () => {
    expect(stepWithinDay(layout, 'b', 'down'))
      .toEqual({ slotKey: 'meal-1', kind: 'meal', index: 0, crossing: 'into-meal' });
  });

  it('steps up from the top of a slot into the previous (empty) meal pairing — at its end', () => {
    // 'c' is top of 'breakfast'; previous slot is the empty meal pairing.
    expect(stepWithinDay(layout, 'c', 'up'))
      .toEqual({ slotKey: 'meal-1', kind: 'meal', index: 0, crossing: 'into-meal' });
  });

  it('steps out of a meal pairing into the next slot (out-of-meal)', () => {
    const withMealTask: DayLayout = [
      { slotKey: 'meal-1', kind: 'meal', taskIds: ['m'] },
      { slotKey: 'breakfast', kind: 'slot', taskIds: ['c'] },
    ];
    expect(stepWithinDay(withMealTask, 'm', 'down'))
      .toEqual({ slotKey: 'breakfast', kind: 'slot', index: 0, crossing: 'out-of-meal' });
  });

  it('steps between two plain slots (to-slot)', () => {
    const twoSlots: DayLayout = [
      { slotKey: 'start of day', kind: 'slot', taskIds: ['a'] },
      { slotKey: 'breakfast', kind: 'slot', taskIds: ['c'] },
    ];
    expect(stepWithinDay(twoSlots, 'a', 'down'))
      .toEqual({ slotKey: 'breakfast', kind: 'slot', index: 0, crossing: 'to-slot' });
  });

  it('returns null for an unknown task id', () => {
    expect(stepWithinDay(layout, 'zzz', 'down')).toBeNull();
  });
});

describe('resolveDayJump', () => {
  it('keeps the slot key when the target day has it', () => {
    expect(resolveDayJump('breakfast', ['<sched>', 'breakfast', 'lunch'])).toBe('breakfast');
  });
  it('falls back to <sched> when the target day lacks the slot', () => {
    expect(resolveDayJump('brunch', ['<sched>', 'lunch'])).toBe('<sched>');
  });
});

describe('describeMove / describeDayJump', () => {
  it('announces same-slot direction', () => {
    expect(describeMove({ crossing: 'same-slot', dir: 'up' })).toBe('Moved up');
    expect(describeMove({ crossing: 'same-slot', dir: 'down' })).toBe('Moved down');
  });
  it('announces into / out of a meal by label', () => {
    expect(describeMove({ crossing: 'into-meal', dir: 'up', targetLabel: 'Breakfast' }))
      .toBe('Moved into Breakfast');
    expect(describeMove({ crossing: 'out-of-meal', dir: 'down', sourceLabel: 'Breakfast' }))
      .toBe('Moved out of Breakfast');
  });
  it('announces a to-slot move by target label', () => {
    expect(describeMove({ crossing: 'to-slot', dir: 'down', targetLabel: 'after Lunch' }))
      .toBe('Moved to after Lunch');
  });
  it('announces a day jump with and without a slot label', () => {
    expect(describeDayJump({ dayLabel: 'Tuesday', targetLabel: 'after Breakfast' }))
      .toBe('Moved to Tuesday, after Breakfast');
    expect(describeDayJump({ dayLabel: 'Tuesday' }))
      .toBe('Moved to Tuesday, unanchored');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: FAIL — `reorder-navigation` module not found.

- [ ] **Step 3: Implement the helper**

Create `plnd_client/src/app/core/utils/reorder-navigation.ts`:

```ts
export type SlotKind = 'slot' | 'meal';

/** One drop target within a single day, in visual reading order. */
export interface DaySlot {
  /** after_anchor label, meal id/name, or '<sched>'. */
  slotKey: string;
  kind: SlotKind;
  /** Ordered ids of the tasks currently in this slot. */
  taskIds: string[];
}

/** The slots of one day, top-to-bottom. */
export type DayLayout = DaySlot[];

export type Crossing = 'same-slot' | 'to-slot' | 'into-meal' | 'out-of-meal';

/** Where an earlier/later step lands. `index` is the 0-based insert index in the target slot. */
export interface MoveResult {
  slotKey: string;
  kind: SlotKind;
  index: number;
  crossing: Crossing;
}

/** Locate a task: which slot it's in and its index within that slot. */
function locate(layout: DayLayout, taskId: string): { slotIdx: number; within: number } | null {
  for (let s = 0; s < layout.length; s++) {
    const within = layout[s].taskIds.indexOf(taskId);
    if (within !== -1) return { slotIdx: s, within };
  }
  return null;
}

function crossingFor(from: SlotKind, to: SlotKind): Crossing {
  if (from === to) return 'to-slot';
  return to === 'meal' ? 'into-meal' : 'out-of-meal';
}

/**
 * Step a task one position earlier ('up') or later ('down') through the day's
 * reading order. Within a slot it reorders; at a slot edge it crosses into the
 * adjacent slot (its end when stepping up, its start when stepping down), which
 * lands correctly in an empty slot. Returns null at the day's first/last position.
 */
export function stepWithinDay(layout: DayLayout, taskId: string, dir: 'up' | 'down'): MoveResult | null {
  const loc = locate(layout, taskId);
  if (!loc) return null;
  const cur = layout[loc.slotIdx];

  if (dir === 'up') {
    if (loc.within > 0) {
      return { slotKey: cur.slotKey, kind: cur.kind, index: loc.within - 1, crossing: 'same-slot' };
    }
    // Top of its slot — move to the previous slot, inserting at its end.
    if (loc.slotIdx === 0) return null;
    const prev = layout[loc.slotIdx - 1];
    return { slotKey: prev.slotKey, kind: prev.kind, index: prev.taskIds.length, crossing: crossingFor(cur.kind, prev.kind) };
  }

  // dir === 'down'
  if (loc.within < cur.taskIds.length - 1) {
    return { slotKey: cur.slotKey, kind: cur.kind, index: loc.within + 1, crossing: 'same-slot' };
  }
  // Bottom of its slot — move to the next slot, inserting at its start.
  if (loc.slotIdx === layout.length - 1) return null;
  const next = layout[loc.slotIdx + 1];
  return { slotKey: next.slotKey, kind: next.kind, index: 0, crossing: crossingFor(cur.kind, next.kind) };
}

/** The slot key a day-jumped task lands in on the target day: same key if present, else unanchored. */
export function resolveDayJump(currentSlotKey: string, targetDaySlotKeys: string[]): string {
  return targetDaySlotKeys.includes(currentSlotKey) ? currentSlotKey : '<sched>';
}

/** Compose the aria-live message for a within-day move. */
export function describeMove(p: { crossing: Crossing; dir: 'up' | 'down'; targetLabel?: string; sourceLabel?: string }): string {
  switch (p.crossing) {
    case 'same-slot':   return p.dir === 'up' ? 'Moved up' : 'Moved down';
    case 'into-meal':   return `Moved into ${p.targetLabel}`;
    case 'out-of-meal': return `Moved out of ${p.sourceLabel}`;
    case 'to-slot':     return `Moved to ${p.targetLabel}`;
  }
}

/** Compose the aria-live message for a cross-day jump. */
export function describeDayJump(p: { dayLabel: string; targetLabel?: string }): string {
  return `Moved to ${p.dayLabel}, ${p.targetLabel ?? 'unanchored'}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: PASS (all `reorder-navigation` tests green).

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/core/utils/reorder-navigation.ts plnd_client/src/app/core/utils/reorder-navigation.spec.ts
git commit -m "feat(reorder): pure navigation helper for keyboard task reorder (#986)"
```

---

## Task 2: `ReorderControlsComponent` (presentational)

**Files:**
- Create: `plnd_client/src/app/features/schedule/components/reorder-controls/reorder-controls.ts`
- Create: `plnd_client/src/app/features/schedule/components/reorder-controls/reorder-controls.scss`
- Test: `plnd_client/src/app/features/schedule/components/reorder-controls/reorder-controls.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: selector `app-reorder-controls` with
  - inputs `label: string`, `canUp = false`, `canDown = false`, `canPrevDay?: boolean`, `canNextDay?: boolean`
  - outputs `up`, `down`, `prevDay`, `nextDay` (all `void`)
  - Day-jump buttons render only when `canPrevDay`/`canNextDay` are **defined**.

- [ ] **Step 1: Write the failing tests**

Create `plnd_client/src/app/features/schedule/components/reorder-controls/reorder-controls.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Component, signal } from '@angular/core';
import { ReorderControlsComponent } from './reorder-controls';

@Component({
  standalone: true,
  imports: [ReorderControlsComponent],
  template: `<app-reorder-controls
    [label]="'Take meds'" [canUp]="canUp()" [canDown]="canDown()"
    [canPrevDay]="canPrevDay()" [canNextDay]="canNextDay()"
    (up)="ups = ups + 1" (down)="downs = downs + 1"
    (prevDay)="prevs = prevs + 1" (nextDay)="nexts = nexts + 1" />`,
})
class HostComponent {
  canUp = signal(true);
  canDown = signal(true);
  canPrevDay = signal<boolean | undefined>(undefined);
  canNextDay = signal<boolean | undefined>(undefined);
  ups = 0; downs = 0; prevs = 0; nexts = 0;
}

function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

describe('ReorderControlsComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders up/down but NOT day-jump buttons when canPrevDay/canNextDay are undefined', () => {
    const fixture = setup();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-up"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-down"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-prev-day"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-next-day"]'))).toBeNull();
  });

  it('renders day-jump buttons when the can*Day inputs are defined', () => {
    const fixture = setup();
    fixture.componentInstance.canPrevDay.set(false);
    fixture.componentInstance.canNextDay.set(true);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-prev-day"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-next-day"]'))).toBeTruthy();
  });

  it('disables a direction when its can flag is false', () => {
    const fixture = setup();
    fixture.componentInstance.canUp.set(false);
    fixture.detectChanges();
    const up = fixture.debugElement.query(By.css('[data-testid="reorder-up"]')).nativeElement as HTMLButtonElement;
    expect(up.disabled).toBe(true);
  });

  it('emits up/down on click', () => {
    const fixture = setup();
    fixture.debugElement.query(By.css('[data-testid="reorder-up"]')).nativeElement.click();
    fixture.debugElement.query(By.css('[data-testid="reorder-down"]')).nativeElement.click();
    expect(fixture.componentInstance.ups).toBe(1);
    expect(fixture.componentInstance.downs).toBe(1);
  });

  it('gives each button an aria-label naming the task and action', () => {
    const fixture = setup();
    const up = fixture.debugElement.query(By.css('[data-testid="reorder-up"]')).nativeElement as HTMLButtonElement;
    expect(up.getAttribute('aria-label')).toBe('Move Take meds earlier');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: FAIL — `ReorderControlsComponent` not found.

- [ ] **Step 3: Implement the component**

Create `plnd_client/src/app/features/schedule/components/reorder-controls/reorder-controls.ts`:

```ts
import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';

/**
 * Presentational reorder affordance. Hidden until the host row is :focus-within
 * (see reorder-controls.scss). Renders ↑/↓ always; «/» only when the day-jump
 * inputs are provided (the wizards), so the day view shows just two buttons.
 */
@Component({
  selector: 'app-reorder-controls',
  standalone: true,
  template: `
    <span class="reorder-controls">
      <button type="button" class="reorder-btn" data-testid="reorder-up"
        [disabled]="!canUp()" [attr.aria-label]="'Move ' + label() + ' earlier'"
        (click)="up.emit()">↑</button>
      <button type="button" class="reorder-btn" data-testid="reorder-down"
        [disabled]="!canDown()" [attr.aria-label]="'Move ' + label() + ' later'"
        (click)="down.emit()">↓</button>
      @if (canPrevDay() !== undefined) {
        <button type="button" class="reorder-btn" data-testid="reorder-prev-day"
          [disabled]="!canPrevDay()" [attr.aria-label]="'Move ' + label() + ' to the previous day'"
          (click)="prevDay.emit()">«</button>
      }
      @if (canNextDay() !== undefined) {
        <button type="button" class="reorder-btn" data-testid="reorder-next-day"
          [disabled]="!canNextDay()" [attr.aria-label]="'Move ' + label() + ' to the next day'"
          (click)="nextDay.emit()">»</button>
      }
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './reorder-controls.scss',
})
export class ReorderControlsComponent {
  readonly label      = input.required<string>();
  readonly canUp      = input(false);
  readonly canDown    = input(false);
  readonly canPrevDay = input<boolean | undefined>(undefined);
  readonly canNextDay = input<boolean | undefined>(undefined);

  readonly up      = output<void>();
  readonly down    = output<void>();
  readonly prevDay = output<void>();
  readonly nextDay = output<void>();
}
```

Create `plnd_client/src/app/features/schedule/components/reorder-controls/reorder-controls.scss`:

```scss
.reorder-controls {
  display: inline-flex;
  gap: 2px;
  margin-left: 8px;
  /* Hidden in the resting UI; revealed when the host row gains focus.
     visibility (not display) keeps layout stable as focus moves. */
  visibility: hidden;
}

.reorder-btn {
  border: 1px solid var(--color-border-input);
  background: var(--color-surface-white);
  border-radius: 4px;
  width: 22px;
  height: 22px;
  line-height: 1;
  font-size: 13px;
  cursor: pointer;
  color: var(--color-text-body);
}

.reorder-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.reorder-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
```

Note: the **reveal** rule lives on each host row (Task 3 / Tasks 6 & 8), keyed off that row's `:focus-within`, because only the host knows its row container selector.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/features/schedule/components/reorder-controls/
git commit -m "feat(reorder): focus-revealed reorder controls component (#986)"
```

---

## Task 3: Embed controls in `app-task-row`

The day view (slots + during-meal rows) both render `app-task-row`, so embedding the controls here wires both at once. The wizards use inline rows and host `app-reorder-controls` directly (Tasks 6, 8).

**Files:**
- Modify: `plnd_client/src/app/features/schedule/components/task-row/task-row.ts`
- Modify: `plnd_client/src/app/features/schedule/components/task-row/task-row.scss`
- Test: `plnd_client/src/app/features/schedule/components/task-row/task-row.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `ReorderControlsComponent` (Task 2).
- Produces: `app-task-row` gains inputs `canMoveUp = false`, `canMoveDown = false`, `canMovePrevDay?: boolean`, `canMoveNextDay?: boolean`; outputs `moveUp`, `moveDown`, `movePrevDay`, `moveNextDay` — each `output<string>` emitting `item().id`.

- [ ] **Step 1: Write the failing test**

Create/extend `plnd_client/src/app/features/schedule/components/task-row/task-row.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TaskRowComponent } from './task-row';
import { ScheduleTask } from '../../../../core/models/schedule';

function task(): ScheduleTask {
  return { id: 't1', type: 'general', label: 'Take meds', status: 'pending', oneShot: false, floating: true };
}

describe('TaskRowComponent reorder controls', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('emits moveUp with the task id when the up control is clicked', () => {
    const fixture = TestBed.createComponent(TaskRowComponent);
    fixture.componentRef.setInput('item', task());
    fixture.componentRef.setInput('canMoveUp', true);
    let emitted: string | undefined;
    fixture.componentInstance.moveUp.subscribe((id: string) => (emitted = id));
    fixture.detectChanges();
    fixture.debugElement.query(By.css('[data-testid="reorder-up"]')).nativeElement.click();
    expect(emitted).toBe('t1');
  });

  it('does not render day-jump buttons when canMovePrevDay/NextDay are undefined', () => {
    const fixture = TestBed.createComponent(TaskRowComponent);
    fixture.componentRef.setInput('item', task());
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-next-day"]'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: FAIL — no `reorder-up` button / `moveUp` output on `TaskRowComponent`.

- [ ] **Step 3: Add inputs/outputs and render the controls**

In `task-row.ts`: add `ReorderControlsComponent` to `imports`, add the inputs/outputs to the class, and render the control inside the `.task-row` div (after the `.label` span, before the type badge). Class additions:

```ts
import { ReorderControlsComponent } from '../reorder-controls/reorder-controls';
// ...add ReorderControlsComponent to the component's imports array...

// inside class TaskRowComponent:
readonly canMoveUp      = input(false);
readonly canMoveDown    = input(false);
readonly canMovePrevDay = input<boolean | undefined>(undefined);
readonly canMoveNextDay = input<boolean | undefined>(undefined);

readonly moveUp      = output<string>();
readonly moveDown    = output<string>();
readonly movePrevDay = output<string>();
readonly moveNextDay = output<string>();
```

Template — insert immediately after the `.label` span (line ~44), before the `@if (typeBadge())` block:

```html
<app-reorder-controls
  [label]="item().label"
  [canUp]="canMoveUp()" [canDown]="canMoveDown()"
  [canPrevDay]="canMovePrevDay()" [canNextDay]="canMoveNextDay()"
  (up)="moveUp.emit(item().id)" (down)="moveDown.emit(item().id)"
  (prevDay)="movePrevDay.emit(item().id)" (nextDay)="moveNextDay.emit(item().id)"
/>
```

- [ ] **Step 4: Add the focus-reveal rule**

In `task-row.scss`, add (the controls live inside `.task-row`):

```scss
.task-row:focus-within app-reorder-controls .reorder-controls {
  visibility: visible;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plnd_client/src/app/features/schedule/components/task-row/
git commit -m "feat(reorder): embed reorder controls in task-row (#986)"
```

---

## Task 4: Wire the day view (slots + during-meal) to reposition

**Files:**
- Modify: `plnd_client/src/app/features/schedule/components/meal-row/meal-row.ts` (forward caps + move events to during-meal `app-task-row`s)
- Modify: `plnd_client/src/app/features/day-view/day-view.ts` (layout, caps, handlers, focus, announce)
- Test: `plnd_client/src/app/features/day-view/day-view.spec.ts`

**Interfaces:**
- Consumes: `stepWithinDay`, `describeMove`, `DayLayout` (Task 1); `app-task-row` move I/O (Task 3); `ScheduleService.repositionTask` (existing); `LiveAnnouncer` from `@angular/cdk/a11y`.
- Produces (meal-row): input `taskCaps: Map<string, { up: boolean; down: boolean }>` (default empty `Map`); outputs `moveTaskUp`, `moveTaskDown` (`output<string>`, the task id).

- [ ] **Step 1: Write the failing test**

Add to `day-view.spec.ts` (the file already has `makeScheduleServiceMock` with `repositionTask: vi.fn().mockReturnValue(of(undefined))`). Build a two-task slot group and assert clicking the down control on the first task calls `repositionTask` with the second task's slot and index 1:

```ts
it('keyboard down on a slot task calls repositionTask with the next position', () => {
  const tasks: ScheduleTask[] = [
    { id: 'a', type: 'general', label: 'A', status: 'pending', oneShot: false, floating: true },
    { id: 'b', type: 'general', label: 'B', status: 'pending', oneShot: false, floating: true },
  ];
  const slotGroups: SlotGroup[] = [{ anchorLabel: 'start of day', anchor: null, tasks }];
  const svc = makeScheduleServiceMock({ slotGroups });
  TestBed.configureTestingModule({
    imports: [DayViewComponent],
    providers: [
      { provide: ScheduleService, useValue: svc },
      { provide: BriefingService, useValue: makeBriefingServiceMock() },
      { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { params: of({ date: '2026-03-19' }) } },
    ],
  });
  const fixture = TestBed.createComponent(DayViewComponent);
  fixture.detectChanges();

  // First task's down control.
  const downBtns = fixture.debugElement.queryAll(By.css('[data-testid="reorder-down"]'));
  downBtns[0].nativeElement.click();

  expect(svc.repositionTask).toHaveBeenCalledWith('a', '2026-03-19', { afterAnchor: 'start of day' }, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: FAIL — controls disabled (no caps) / handler absent, `repositionTask` not called.

- [ ] **Step 3: Extend meal-row to forward caps and move events**

In `meal-row.ts` add to the class:

```ts
/** Per-during-meal-task move capability, keyed by task id. */
readonly taskCaps = input<Map<string, { up: boolean; down: boolean }>>(new Map());
readonly moveTaskUp   = output<string>();
readonly moveTaskDown = output<string>();
```

On the during-meal `app-task-row` (inside the `@for`), bind caps + re-emit:

```html
[canMoveUp]="taskCaps().get(task.id)?.up ?? false"
[canMoveDown]="taskCaps().get(task.id)?.down ?? false"
(moveUp)="moveTaskUp.emit($event)"
(moveDown)="moveTaskDown.emit($event)"
```

- [ ] **Step 4: Build the day-view layout, caps, handlers, focus, and announcer**

In `day-view.ts`:

Add imports and an injected announcer:

```ts
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { DayLayout, stepWithinDay, describeMove, MoveResult } from '../../core/utils/reorder-navigation';
// in the class:
private readonly announcer = inject(LiveAnnouncer);
```

Add a computed `DayLayout` built from the mutable maps (so it tracks optimistic moves), and a caps map:

```ts
/** Day layout in reading order: each meal group emits its during-meal list then its slot list. */
readonly dayLayout = computed<DayLayout>(() => {
  const layout: DayLayout = [];
  for (const g of this.scheduleService.slotGroups()) {
    if (g.anchor && isMealAnchor(g.anchor)) {
      const meal = this.mealAnchor(g.anchor.id);
      layout.push({ slotKey: g.anchor.id, kind: 'meal', taskIds: (meal?.duringMealTasks ?? []).map(t => t.id) });
    }
    layout.push({ slotKey: g.anchorLabel, kind: 'slot', taskIds: this.slotTasks(g.anchorLabel).map(t => t.id) });
  }
  return layout;
});

/** Per-task move capability for the template + meal-row. */
readonly moveCaps = computed(() => {
  const layout = this.dayLayout();
  const caps = new Map<string, { up: boolean; down: boolean }>();
  for (const slot of layout) {
    for (const id of slot.taskIds) {
      caps.set(id, { up: stepWithinDay(layout, id, 'up') !== null, down: stepWithinDay(layout, id, 'down') !== null });
    }
  }
  return caps;
});
```

Bind caps on the slot `app-task-row` in the template:

```html
[canMoveUp]="moveCaps().get(task.id)?.up ?? false"
[canMoveDown]="moveCaps().get(task.id)?.down ?? false"
(moveUp)="onKeyboardMove($event, 'up')"
(moveDown)="onKeyboardMove($event, 'down')"
```

And on `app-meal-row` pass `[taskCaps]="moveCaps()"` and bind `(moveTaskUp)="onKeyboardMove($event, 'up')" (moveTaskDown)="onKeyboardMove($event, 'down')"`.

Add the handler. It mirrors `onSlotDrop`/`onMealDrop`: locate the task in the local maps, apply the move optimistically to the right arrays, persist, focus, announce.

```ts
/** Find the mutable array + index holding a task id across slot maps and meal clones. */
private findTaskArray(taskId: string): { arr: ScheduleTask[]; index: number } | null {
  for (const arr of this.slotGroupMap().values()) {
    const i = arr.findIndex(t => t.id === taskId);
    if (i !== -1) return { arr, index: i };
  }
  for (const meal of this.mealAnchorMap().values()) {
    const i = meal.duringMealTasks.findIndex(t => t.id === taskId);
    if (i !== -1) return { arr: meal.duringMealTasks, index: i };
  }
  return null;
}

/** Target mutable array for a resolved MoveResult slot key. */
private targetArray(result: MoveResult): ScheduleTask[] | null {
  return result.kind === 'meal'
    ? this.mealAnchorMap().get(result.slotKey)?.duringMealTasks ?? null
    : this.slotGroupMap().get(result.slotKey) ?? null;
}

/** Display label for a slot key (meal name for a meal, the capitalized anchor label otherwise). */
private slotLabel(result: MoveResult): string {
  if (result.kind === 'meal') return this.mealAnchor(result.slotKey)?.name ?? 'meal';
  return result.slotKey === 'start of day' ? 'start of day' : `after ${result.slotKey}`;
}

onKeyboardMove(taskId: string, dir: 'up' | 'down'): void {
  const result = stepWithinDay(this.dayLayout(), taskId, dir);
  if (!result) return; // at the day edge — control was disabled anyway
  const src = this.findTaskArray(taskId);
  const dst = this.targetArray(result);
  if (!src || !dst) return;

  // Capture source meal name (for an out-of-meal announcement) before mutating.
  const sourceMeal = [...this.mealAnchorMap().values()].find(m => m.duringMealTasks.some(t => t.id === taskId));

  const [moved] = src.arr.splice(src.index, 1);
  dst.splice(result.index, 0, moved);

  // Trigger OnPush re-render by re-setting the signal maps (mutated in place).
  this.slotGroupMap.set(new Map(this.slotGroupMap()));
  this.mealAnchorMap.set(new Map(this.mealAnchorMap()));

  this.announcer.announce(describeMove({
    crossing: result.crossing, dir,
    targetLabel: this.slotLabel(result),
    sourceLabel: sourceMeal?.name,
  }), 'polite');

  const target = result.kind === 'meal' ? { mealAnchorId: result.slotKey } : { afterAnchor: result.slotKey };
  this.persistReposition(moved.id, target, result.index);
  this.refocusReorderButton(taskId, dir);
}

/**
 * Re-focus the moved task's control. Runs once immediately (the optimistic
 * re-render already placed the button) AND again after the async loadDay
 * re-sync rebuilds the rows — the second pass is why we stash a pending focus
 * request that the constructor effect re-applies once slotGroups() re-emits.
 */
private readonly pendingFocus = signal<{ taskId: string; dir: 'up' | 'down' } | null>(null);

private refocusReorderButton(taskId: string, dir: 'up' | 'down'): void {
  this.pendingFocus.set({ taskId, dir });
  queueMicrotask(() => this.applyPendingFocus());
}

private applyPendingFocus(): void {
  const req = this.pendingFocus();
  if (!req) return;
  const row = document.getElementById(`task-row-${req.taskId}`);
  if (!row) return; // row absent (rolled back / not yet rebuilt) — leave pending for the next pass
  const same = row.querySelector<HTMLButtonElement>(`[data-testid="reorder-${req.dir}"]`);
  if (same && !same.disabled) { same.focus(); this.pendingFocus.set(null); return; }
  const other = row.querySelector<HTMLButtonElement>(`[data-testid="reorder-${req.dir === 'up' ? 'down' : 'up'}"]`);
  if (other && !other.disabled) { other.focus(); this.pendingFocus.set(null); return; }
  row.querySelector<HTMLElement>('.label')?.focus();
  this.pendingFocus.set(null);
}
```

In the constructor `effect()` that rebuilds the maps, add a trailing
`queueMicrotask(() => this.applyPendingFocus())` so focus is re-applied after the
`loadDay` re-sync rebuilds the rows. Because the effect reads `slotGroups()`, it
re-runs when the reload lands; the microtask defers focus until the DOM has the
rebuilt row.

Note: `persistReposition` already exists and calls `loadDay` on success (re-sync) and on error (rollback) — reuse it unchanged.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 6: Add an into-meal and an error-rollback test**

Append to `day-view.spec.ts`:

```ts
it('keyboard up on the top slot task moves it into the preceding meal pairing', () => {
  const meal: MealAnchor = {
    id: 'm1', name: 'Breakfast', emoji: '🥣', status: 'planned', duringMealTasks: [],
  };
  const slotTask: ScheduleTask = { id: 'c', type: 'general', label: 'C', status: 'pending', oneShot: false, floating: true };
  const slotGroups: SlotGroup[] = [{ anchorLabel: 'breakfast', anchor: meal, tasks: [slotTask] }];
  const svc = makeScheduleServiceMock({ slotGroups });
  TestBed.configureTestingModule({
    imports: [DayViewComponent],
    providers: [
      { provide: ScheduleService, useValue: svc },
      { provide: BriefingService, useValue: makeBriefingServiceMock() },
      { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { params: of({ date: '2026-03-19' }) } },
    ],
  });
  const fixture = TestBed.createComponent(DayViewComponent);
  fixture.detectChanges();
  // The slot task's up control (the meal's during-meal list is empty, so this is the only up button).
  fixture.debugElement.queryAll(By.css('[data-testid="reorder-up"]'))
    .at(-1)!.nativeElement.click();
  expect(svc.repositionTask).toHaveBeenCalledWith('c', '2026-03-19', { mealAnchorId: 'm1' }, 0);
});

it('rolls back via loadDay when reposition fails', () => {
  const tasks: ScheduleTask[] = [
    { id: 'a', type: 'general', label: 'A', status: 'pending', oneShot: false, floating: true },
    { id: 'b', type: 'general', label: 'B', status: 'pending', oneShot: false, floating: true },
  ];
  const svc = makeScheduleServiceMock({ slotGroups: [{ anchorLabel: 'start of day', anchor: null, tasks }] });
  svc.repositionTask = vi.fn().mockReturnValue(throwError(() => new Error('boom')));
  TestBed.configureTestingModule({
    imports: [DayViewComponent],
    providers: [
      { provide: ScheduleService, useValue: svc },
      { provide: BriefingService, useValue: makeBriefingServiceMock() },
      { provide: TimezoneService, useValue: makeTimezoneServiceMock() },
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { params: of({ date: '2026-03-19' }) } },
    ],
  });
  const fixture = TestBed.createComponent(DayViewComponent);
  fixture.detectChanges();
  fixture.debugElement.queryAll(By.css('[data-testid="reorder-down"]'))[0].nativeElement.click();
  expect(svc.loadDay).toHaveBeenCalledWith('2026-03-19');
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plnd_client/src/app/features/day-view/ plnd_client/src/app/features/schedule/components/meal-row/
git commit -m "feat(reorder): keyboard reorder wired into the day view (#986)"
```

---

## Task 5: Day-view keyboard reorder e2e

**Files:**
- Create: `plnd_client/e2e/day-view-keyboard-reorder.e2e.ts`

**Interfaces:**
- Consumes: `seedAuth`, `seedScheduleEntries` (existing helpers in `e2e/helpers/`).

- [ ] **Step 1: Write the e2e test**

Create `plnd_client/e2e/day-view-keyboard-reorder.e2e.ts`. Seed two floating tasks in one slot via the real API, focus the first task, click its `↓` control, reload, and assert the new order persisted. (Mirror an existing day-view e2e for the seeding/navigation boilerplate — e.g. the drag e2e added in the drag PR.)

```ts
import { test, expect } from '@playwright/test';
import { seedAuth } from './helpers/auth';
import { seedScheduleEntries } from './helpers/seed-data';

test('reorders a floating task down via the keyboard control and persists across reload', async ({ page }) => {
  const date = '2026-03-19';
  await seedAuth(page);
  await seedScheduleEntries(page, date, [
    { title: 'Alpha', after_anchor: 'start of day', slot_position: 0 },
    { title: 'Beta',  after_anchor: 'start of day', slot_position: 1 },
  ]);

  await page.goto(`/day/${date}`);
  const rows = page.getByTestId('task-row');
  await expect(rows.nth(0)).toContainText('Alpha');

  // Focus the first row (its label) to reveal controls, then move it down.
  await rows.nth(0).getByText('Alpha').focus();
  await rows.nth(0).getByTestId('reorder-down').click();

  await expect(page.getByTestId('task-row').nth(0)).toContainText('Beta');

  await page.reload();
  await expect(page.getByTestId('task-row').nth(0)).toContainText('Beta');
});
```

- [ ] **Step 2: Run the e2e leg**

Run: `cd plnd_client && cd .. && just verify e2e > /tmp/verify-e2e.log 2>&1`
Then read `/tmp/verify-e2e.log` and confirm `✅ All verifications passed` (or the e2e leg's success line). Expected: the new test passes against the real backend.

If `seedScheduleEntries` does not yet accept `slot_position`, check its signature in `e2e/helpers/seed-data.ts` and pass the field the helper supports (it was extended for the drag work); adjust the seed call to match.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/day-view-keyboard-reorder.e2e.ts
git commit -m "test(reorder): day-view keyboard reorder e2e (#986)"
```

---

## Phase 1 close-out

- [ ] **Run full verification**

Run: `cd plnd_client && cd .. && just fmt && just verify > /tmp/verify-p1.log 2>&1`
Read `/tmp/verify-p1.log`; require the literal `✅ All verifications passed`. Do not trust the wrapper exit code.

- [ ] **Open PR 1**

```bash
git fetch origin && git rebase origin/main
git push --force-with-lease -u origin <branch>
gh pr create --base main --title "feat(reorder): keyboard/button reorder — shared primitives + day view (#986)" \
  --body "Phase 1 of #986. Adds the pure reorder-navigation helper, the focus-revealed ReorderControlsComponent, and wires keyboard reorder into the day view (within slot, between slots, into/out of a meal). No backend changes. Part of #986."
```

Then invoke the `monitor-pr` skill.

---

# Phase 2 — The two wizards (PR 2)

> Depends on Phase 1's `reorder-navigation.ts` and `ReorderControlsComponent` being merged to `main`. Branch fresh from `origin/main`.

## Task 6: Onboarding placement review — keyboard reorder + day jump

**Files:**
- Modify: `plnd_client/src/app/features/onboarding/tasks/substeps/task-placement-review-substep/task-placement-review-substep.ts`
- Test: `plnd_client/src/app/features/onboarding/tasks/substeps/task-placement-review-substep/task-placement-review-substep.spec.ts`

**Interfaces:**
- Consumes: `stepWithinDay`, `resolveDayJump`, `describeMove`, `describeDayJump`, `DayLayout` (Task 1); `ReorderControlsComponent` (Task 2); `LiveAnnouncer`.
- The surface already keys tasks by `entryIndex` and mutates the `entries` signal (see `onDrop`). Reorder reuses that mutation shape.

- [ ] **Step 1: Write the failing test**

Add to the substep spec. Build two entries in one `<sched>` slot on the same date, render, click the first row's `↓`, assert the entries array order swapped. (The component computes `daySections()` from `entries()`; clicking the down control must reorder via the same `entries` mutation `onDrop` uses.)

```ts
it('keyboard down reorders two entries within a slot', () => {
  // ...arrange the component with two entries (see existing spec's setup helpers)...
  // Identify the first task row's down control and click it:
  const downs = fixture.debugElement.queryAll(By.css('[data-testid="reorder-down"]'));
  downs[0].nativeElement.click();
  fixture.detectChanges();
  const titles = fixture.debugElement.queryAll(By.css('.task-title')).map(d => d.nativeElement.textContent.trim());
  expect(titles).toEqual(['Second', 'First']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: FAIL — no reorder control rendered.

- [ ] **Step 3: Render the controls and add handlers**

Add `ReorderControlsComponent` to `imports` and inject `LiveAnnouncer`. In the default (non-editing) task row template (the `@else` branch's `.task-row`), add after `.task-title`:

```html
<app-reorder-controls
  [label]="row.entry.title"
  [canUp]="rowCaps(card.date, row.entry).up" [canDown]="rowCaps(card.date, row.entry).down"
  [canPrevDay]="!isFirstDay(card.date)" [canNextDay]="!isLastDay(card.date)"
  (up)="onMove(card.date, row.entry, 'up')" (down)="onMove(card.date, row.entry, 'down')"
  (prevDay)="onDayJump(card.date, row.entry, -1)" (nextDay)="onDayJump(card.date, row.entry, 1)"
/>
```

Add a focus-reveal rule to the component `styles` array:

```scss
.task-row:focus-within app-reorder-controls .reorder-controls { visibility: visible; }
```

Add layout/caps/handlers. The layout for a day is its `DaySection[]` mapped to `DayLayout` (each section → a `DaySlot`, kind `'meal'` when `mealLabel` is set):

```ts
private dayLayoutFor(date: string): DayLayout {
  const card = this.daySections().find(c => c.date === date);
  if (!card) return [];
  return card.sections.map(s => ({
    slotKey: s.slotKey,
    kind: s.mealLabel ? 'meal' as const : 'slot' as const,
    taskIds: s.taskRows.map(r => `${r.entryIndex}`),
  }));
}

rowCaps(date: string, entry: PlaceTasksEntry): { up: boolean; down: boolean } {
  const idx = this.entries().indexOf(entry);
  const layout = this.dayLayoutFor(date);
  const id = `${idx}`;
  return { up: stepWithinDay(layout, id, 'up') !== null, down: stepWithinDay(layout, id, 'down') !== null };
}

private allDates(): string[] { return this.daySections().map(c => c.date); }
isFirstDay(date: string): boolean { return this.allDates()[0] === date; }
isLastDay(date: string): boolean { return this.allDates().at(-1) === date; }

onMove(date: string, entry: PlaceTasksEntry, dir: 'up' | 'down'): void {
  const idx = this.entries().indexOf(entry);
  if (idx === -1) return;
  const result = stepWithinDay(this.dayLayoutFor(date), `${idx}`, dir);
  if (!result) return;
  // Reuse the onDrop mutation: same date, target slot key, target index.
  const sourceSlotLabel = this.slotLabelFor(date, entry);
  this.applyMove(entry, date, result.slotKey, result.index);
  this.announceMove(result, dir, date, sourceSlotLabel);
}

onDayJump(date: string, entry: PlaceTasksEntry, delta: -1 | 1): void {
  const dates = this.allDates();
  const targetDate = dates[dates.indexOf(date) + delta];
  if (!targetDate) return;
  const targetKeys = this.dayLayoutFor(targetDate).map(s => s.slotKey);
  const targetSlot = resolveDayJump(this.currentSlotKey(entry), targetKeys);
  // Append at end of the resolved slot on the target day.
  const targetLen = this.dayLayoutFor(targetDate).find(s => s.slotKey === targetSlot)?.taskIds.length ?? 0;
  this.applyMove(entry, targetDate, targetSlot, targetLen);
  this.announcer.announce(describeDayJump({
    dayLabel: this.dayLabel(targetDate),
    targetLabel: targetSlot === '<sched>' ? undefined : targetSlot,
  }), 'polite');
}
```

Where `applyMove` factors the existing `onDrop` body (date + slot + index splice). Refactor `onDrop` to call `applyMove(droppedEntry, targetDate, targetSlotKey, event.currentIndex)` so drag and keyboard share one mutation. `currentSlotKey(entry)` returns `entrySlotKey(entry)`; `slotLabelFor`/`dayLabel`/`announceMove` are small helpers composing `describeMove` (`targetLabel` = the meal label or `after <slot>`; `sourceLabel` from the pre-move slot). Reuse `getDayName`/`formatDisplayDate` for `dayLabel`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Add a cross-day jump test**

```ts
it('next-day jump moves an entry to the following date in the unanchored slot', () => {
  // ...arrange two-day horizon with one entry on day 1 in <sched>...
  fixture.debugElement.queryAll(By.css('[data-testid="reorder-next-day"]'))[0].nativeElement.click();
  fixture.detectChanges();
  const entry = fixture.componentInstance.entries()[0];
  expect(entry.scheduled_date).toBe(/* day 2 ISO */);
});
```

- [ ] **Step 6: Run the tests, then commit**

Run: `cd plnd_client && npx ng test --watch=false` → PASS.

```bash
git add plnd_client/src/app/features/onboarding/tasks/substeps/task-placement-review-substep/
git commit -m "feat(reorder): keyboard reorder + day jump in onboarding placement review (#986)"
```

---

## Task 7: Onboarding keyboard reorder e2e

**Files:**
- Create: `plnd_client/e2e/onboarding-keyboard-reorder.e2e.ts`

- [ ] **Step 1: Write the e2e test**

Create `plnd_client/e2e/onboarding-keyboard-reorder.e2e.ts`. Use `seedOnboarding(page)` and the existing agent-mock pattern (placement is an `/agent/*` endpoint, so it MAY be mocked) to render the placement review with two known tasks in one slot; click the first row's `↓`; assert the rendered order swapped. Mirror the placement-review drag e2e for the mock + navigation boilerplate.

```ts
import { test, expect } from '@playwright/test';
import { seedOnboarding } from './helpers/auth';

test('keyboard down reorders two placed tasks in the onboarding review', async ({ page }) => {
  await seedOnboarding(page);
  // ...mock /agent/place-tasks to return two entries 'Alpha','Beta' in one slot (see existing placement e2e)...
  await page.goto('/onboarding/tasks'); // route that renders the placement review substep
  const titles = page.locator('.task-title');
  await expect(titles.nth(0)).toHaveText('Alpha');
  await titles.nth(0).focus();
  await page.locator('.task-row').nth(0).getByTestId('reorder-down').click();
  await expect(page.locator('.task-title').nth(0)).toHaveText('Beta');
});
```

- [ ] **Step 2: Run the e2e leg**

Run: `cd plnd_client && cd .. && just verify e2e > /tmp/verify-e2e.log 2>&1`
Read the log; confirm the success line.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/onboarding-keyboard-reorder.e2e.ts
git commit -m "test(reorder): onboarding keyboard reorder e2e (#986)"
```

---

## Task 8: Weekly day-grid — keyboard reorder + day jump

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.ts`
- Test: `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.spec.ts`

**Interfaces:**
- Consumes: `stepWithinDay`, `resolveDayJump`, `describeMove`, `describeDayJump`, `DayLayout` (Task 1); `ReorderControlsComponent` (Task 2); `LiveAnnouncer`; existing `WeekPlanService.reorderTask` / `updateTaskSlot`.
- `PlannedTask` has no id; rows are keyed by object identity. Build `DayLayout` task ids from a per-render index key (`${slotKey}#${i}`) and resolve a clicked row back to its `PlannedTask` via its slot + index.

- [ ] **Step 1: Write the failing test**

Add to `plan-day-card.spec.ts`: arrange a card with two tasks in the `<sched>` slot, expand it, click the first task's `↓`, assert `WeekPlanService.reorderTask` was called with `(date, '<sched>', 0, 1)`.

```ts
it('keyboard down on a sched task calls reorderTask with the next index', () => {
  // ...arrange WeekPlanService mock with two scheduledTasks on this card's date in <sched>...
  fixture.componentInstance['toggle'](); // expand the card body
  fixture.detectChanges();
  fixture.debugElement.queryAll(By.css('[data-testid="reorder-down"]'))[0].nativeElement.click();
  expect(reorderTaskSpy).toHaveBeenCalledWith('2026-03-19', '<sched>', 0, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: FAIL — no reorder control / handler.

- [ ] **Step 3: Render controls and add handlers**

Add `ReorderControlsComponent` to `imports`, inject `LiveAnnouncer`. On each `.draggable-task` row (both the meal-slot loop and the `<sched>` loop), add the control. Because the meal-slot loop and the sched loop both expose `task` and a known `slotKey`, pass an index:

```html
<!-- inside @for (task of tasksForSlot(entry.name); track task; let i = $index) -->
<app-reorder-controls
  [label]="task.title"
  [canUp]="caps(entry.name, i).up" [canDown]="caps(entry.name, i).down"
  [canPrevDay]="!isFirstDay()" [canNextDay]="!isLastDay()"
  (up)="onMove(entry.name, i, 'up')" (down)="onMove(entry.name, i, 'down')"
  (prevDay)="onDayJump(task, -1)" (nextDay)="onDayJump(task, 1)"
/>
```

(Repeat for the `'<sched>'` loop with `'<sched>'` as the slot key.) Add a `:focus-within` reveal rule in `plan-day-card.scss`.

Handlers:

```ts
private dayLayout(): DayLayout {
  // Reading order: each meal slot, then <sched>, matching the template.
  const slots = this.slots().map(s => s.name).concat('<sched>');
  return slots.map(slotKey => ({
    slotKey,
    kind: slotKey === '<sched>' ? 'slot' as const : 'meal' as const,
    taskIds: this.tasksForSlot(slotKey).map((_t, i) => `${slotKey}#${i}`),
  }));
}

caps(slotKey: string, i: number): { up: boolean; down: boolean } {
  const id = `${slotKey}#${i}`;
  const layout = this.dayLayout();
  return { up: stepWithinDay(layout, id, 'up') !== null, down: stepWithinDay(layout, id, 'down') !== null };
}

isFirstDay(): boolean { return this.horizonDays()[0] === this.date(); }
isLastDay(): boolean { return this.horizonDays().at(-1) === this.date(); }

onMove(slotKey: string, i: number, dir: 'up' | 'down'): void {
  const result = stepWithinDay(this.dayLayout(), `${slotKey}#${i}`, dir);
  if (!result) return;
  const task = this.tasksForSlot(slotKey)[i];
  if (result.crossing === 'same-slot') {
    this.weekPlanService.reorderTask(this.date(), slotKey, i, result.index);
  } else {
    this.weekPlanService.updateTaskSlot(task, this.date(), result.slotKey, result.index);
  }
  this.announcer.announce(describeMove({
    crossing: result.crossing, dir,
    targetLabel: result.slotKey === '<sched>' ? 'Tasks' : result.slotKey,
    sourceLabel: slotKey === '<sched>' ? 'Tasks' : slotKey,
  }), 'polite');
}

onDayJump(task: PlannedTask, delta: -1 | 1): void {
  const days = this.horizonDays();
  const targetDate = days[days.indexOf(this.date()) + delta];
  if (!targetDate) return;
  const targetKeys = this.dayTypesMealsService.mealsForDate(targetDate).map(s => s.name).concat('<sched>');
  const targetSlot = resolveDayJump(taskSlotKey(task), targetKeys);
  const endIndex = this.weekPlanService.scheduledTasks()
    .filter(t => t.date === targetDate && taskSlotKey(t) === targetSlot).length;
  this.weekPlanService.updateTaskSlot(task, targetDate, targetSlot, endIndex);
  this.announcer.announce(describeDayJump({
    dayLabel: targetDate,
    targetLabel: targetSlot === '<sched>' ? undefined : targetSlot,
  }), 'polite');
}
```

Inject `LiveAnnouncer` and use the module-level `taskSlotKey` helper already defined in this file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd plnd_client && npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 5: Add a cross-day jump test**

```ts
it('next-day jump calls updateTaskSlot with the following date', () => {
  // ...arrange a 2-day horizon, one task on day 1...
  fixture.componentInstance['toggle']();
  fixture.detectChanges();
  fixture.debugElement.queryAll(By.css('[data-testid="reorder-next-day"]'))[0].nativeElement.click();
  expect(updateTaskSlotSpy).toHaveBeenCalledWith(expect.anything(), /* day2 */ '2026-03-20', '<sched>', 0);
});
```

- [ ] **Step 6: Run the tests, then commit**

Run: `cd plnd_client && npx ng test --watch=false` → PASS.

```bash
git add plnd_client/src/app/features/planning/steps/plan-day-grid-step/
git commit -m "feat(reorder): keyboard reorder + day jump in weekly day-grid (#986)"
```

---

## Task 9: Weekly day-grid keyboard reorder e2e

**Files:**
- Create: `plnd_client/e2e/weekly-grid-keyboard-reorder.e2e.ts`

- [ ] **Step 1: Write the e2e test**

Create `plnd_client/e2e/weekly-grid-keyboard-reorder.e2e.ts`. Drive the weekly planning wizard to the day-grid step with two known tasks in one day's `<sched>` slot (mock the agent plan endpoint; user/schedule data via the real backend), expand the day card, click the first task's `↓`, assert the order swapped, and (optionally) complete the commit and assert the committed schedule order. Mirror the weekly day-grid drag e2e for setup.

```ts
import { test, expect } from '@playwright/test';
import { seedAuth } from './helpers/auth';

test('keyboard down reorders two tasks in the weekly day-grid card', async ({ page }) => {
  await seedAuth(page);
  // ...drive the wizard to the day-grid step with tasks 'Alpha','Beta' on one day (see existing weekly e2e)...
  const card = page.locator('.day-card').first();
  await card.click(); // expand
  const vals = card.locator('.draggable-task .val');
  await expect(vals.nth(0)).toHaveText('Alpha');
  await vals.nth(0).focus();
  await card.locator('.draggable-task').nth(0).getByTestId('reorder-down').click();
  await expect(card.locator('.draggable-task .val').nth(0)).toHaveText('Beta');
});
```

- [ ] **Step 2: Run the e2e leg**

Run: `cd plnd_client && cd .. && just verify e2e > /tmp/verify-e2e.log 2>&1`
Read the log; confirm the success line.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/e2e/weekly-grid-keyboard-reorder.e2e.ts
git commit -m "test(reorder): weekly day-grid keyboard reorder e2e (#986)"
```

---

## Phase 2 close-out

- [ ] **Run full verification**

Run: `cd plnd_client && cd .. && just fmt && just verify > /tmp/verify-p2.log 2>&1`
Read `/tmp/verify-p2.log`; require `✅ All verifications passed`.

- [ ] **Open PR 2**

```bash
git fetch origin && git rebase origin/main
git push --force-with-lease -u origin <branch>
gh pr create --base main --title "feat(reorder): keyboard/button reorder — onboarding + weekly wizards (#986)" \
  --body "Phase 2 of #986. Adds keyboard reorder (↑/↓) and cross-day jump («/») to the onboarding placement review and the weekly day-grid, reusing the Phase 1 primitives. Closes #986."
```

Then invoke the `monitor-pr` skill.

---

## Notes for the implementer

- **Accessibility is the deliverable.** Every move must (a) keep focus on the moved task's control (re-focus by id/position after re-render), (b) announce via `LiveAnnouncer`, and (c) disable the direction at the day edge (the helper returns `null`). A move that loses focus or goes silent is a defect even if the order is correct.
- **The helper is the single source of truth for "where does it go."** Surfaces must not re-implement boundary logic; they map their assembly to `DayLayout`, call `stepWithinDay`/`resolveDayJump`, and dispatch. If a surface needs different behavior, change the helper and its tests — not the surface.
- **No backend work.** If you find yourself editing `plnd_api` or `plnd_data`, stop — the keyboard path is defined to emit the same `(slot key, position)` drag already persists/commits.
