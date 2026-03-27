# Tasks Step Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `PlanTasksStepComponent` to use per-day accordion cards with inline `AddEntryComponent` morphing forms and a new floating-tasks panel backed by `WeekPlanService.floatingTasks`.

**Architecture:** Three layers of change, each independently committable: (1) CSS tokens in `_tokens.scss`, (2) `FloatingTask` type + `WeekPlanService` signal/methods, (3) full component rewrite with updated spec. The component rewrite drops `ngOnInit`, `ReactiveFormsModule`, and the global add form entirely — replacing them with `computed()` signals and one `AddEntryComponent` per day.

**Tech Stack:** Angular 17+ standalone components, Angular signals (`signal`, `computed`), Jasmine/Karma, SCSS CSS custom properties

---

## File Map

| File | Action | What changes |
|---|---|---|
| `plnd_client/src/styles/_tokens.scss` | Modify | Add 4 `--color-purple-*` tokens to `:root` + `[data-theme="dark"]` |
| `plnd_client/src/app/core/models/week-plan.ts` | Modify | Add `FloatingTask` type alias after `PlannedTask` |
| `plnd_client/src/app/core/services/week-plan.service.ts` | Modify | Add `floatingTasksSignal`, `floatingTasks`, `addFloatingTask()`, `removeFloatingTask()`; update `clearDraft()` |
| `plnd_client/src/app/core/services/week-plan.service.spec.ts` | Modify | Add `describe('floating task management')` block |
| `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.ts` | Rewrite | New template (accordion + floating panel), new styles, new class body |
| `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.spec.ts` | Rewrite | All new tests for redesigned component |

---

## Task 1: Add purple CSS tokens

**Files:**
- Modify: `plnd_client/src/styles/_tokens.scss`

- [ ] **Step 1: Add tokens to `:root`**

In `_tokens.scss`, insert these four lines immediately before the closing `}` of the `:root` block (after `--shadow-dropdown`):

```scss
  --color-purple:        #7c3aed;
  --color-purple-light:  #f5f3ff;
  --color-purple-border: #c4b5fd;
  --color-purple-dark:   #4c1d95;
```

- [ ] **Step 2: Add dark-mode overrides to `[data-theme="dark"]`**

Insert these four lines immediately before the closing `}` of the `[data-theme="dark"]` block (after `--shadow-dropdown`):

```scss
  --color-purple:        #a78bfa;
  --color-purple-light:  rgba(124, 58, 237, 0.15);
  --color-purple-border: #7c3aed;
  --color-purple-dark:   #ddd6fe;
```

- [ ] **Step 3: Verify the file compiles**

```bash
cd plnd_client && npx ng build --configuration=development 2>&1 | grep -E "error|warning" | head -20
```

Expected: no errors related to unknown tokens (SCSS won't error on unused custom properties anyway — this step mainly confirms the file parses cleanly).

- [ ] **Step 4: Commit**

```bash
git add plnd_client/src/styles/_tokens.scss
git commit -m "feat(planning): add purple CSS tokens for floating tasks panel (#60)"
```

---

## Task 2: FloatingTask type + WeekPlanService additions

**Files:**
- Modify: `plnd_client/src/app/core/models/week-plan.ts`
- Modify: `plnd_client/src/app/core/services/week-plan.service.ts`
- Modify: `plnd_client/src/app/core/services/week-plan.service.spec.ts`

- [ ] **Step 1: Add `FloatingTask` type alias to `week-plan.ts`**

In `week-plan.ts`, insert this line immediately after the closing `}` of the `PlannedTask` interface (after line 28):

```ts
export type FloatingTask = Omit<PlannedTask, 'date'>;
```

- [ ] **Step 2: Write failing tests in `week-plan.service.spec.ts`**

Open `plnd_client/src/app/core/services/week-plan.service.spec.ts`. At the end of the file, before the final closing `});` of the outer `describe('WeekPlanService')` block, add a new nested describe:

```ts
  describe('floating task management', () => {
    it('should start with an empty floatingTasks list', () => {
      expect(service.floatingTasks()).toEqual([]);
    });

    it('should append a task via addFloatingTask', () => {
      service.addFloatingTask({ title: 'Call dentist', energy: 'low', task_type: 'custom' });
      expect(service.floatingTasks().length).toBe(1);
      expect(service.floatingTasks()[0].title).toBe('Call dentist');
    });

    it('should remove a task by index via removeFloatingTask', () => {
      service.addFloatingTask({ title: 'Task A', energy: 'low', task_type: 'custom' });
      service.addFloatingTask({ title: 'Task B', energy: 'medium', task_type: 'custom' });
      service.removeFloatingTask(0);
      expect(service.floatingTasks().length).toBe(1);
      expect(service.floatingTasks()[0].title).toBe('Task B');
    });

    it('should clear floatingTasks when clearDraft is called', () => {
      service.addFloatingTask({ title: 'Lingering task', energy: 'medium', task_type: 'custom' });
      service.clearDraft();
      expect(service.floatingTasks()).toEqual([]);
    });
  });
```

Also add this import at the top of the spec file (alongside existing imports):

```ts
import { FloatingTask } from '../models/week-plan';
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd plnd_client && npx ng test --include="**/week-plan.service.spec.ts" --watch=false --browsers=ChromeHeadless 2>&1 | tail -30
```

Expected: 4 failures — `service.floatingTasks is not a function`, `service.addFloatingTask is not a function`, `service.removeFloatingTask is not a function`.

- [ ] **Step 4: Implement `floatingTasks` signal and methods in `week-plan.service.ts`**

**4a.** Add `FloatingTask` to the import from `../models/week-plan` (line 6–10):

```ts
import {
  CarryoverDecision, MealSlot, PlanDraftShape,
  PlanEntryRequest, PlannedMeal, PlannedTask, FloatingTask,
  PostSchedulePlanRequest, PostSchedulePlanResponse,
  PlanStatusResponse, SchedulePeriodResponse,
} from '../models/week-plan';
```

**4b.** After `private readonly isSubmittingSignal = signal<boolean>(false);` (around line 31), add:

```ts
  private readonly floatingTasksSignal = signal<FloatingTask[]>([]);
```

**4c.** After `readonly planningTaskId = this.planningTaskIdSignal.asReadonly();` (around line 42), add:

```ts
  readonly floatingTasks = this.floatingTasksSignal.asReadonly();
```

**4d.** Add these three methods after the existing `removeTask` method (around line 193):

```ts
  addFloatingTask(task: FloatingTask): void {
    this.floatingTasksSignal.update(tasks => [...tasks, task]);
  }

  removeFloatingTask(index: number): void {
    this.floatingTasksSignal.update(tasks => tasks.filter((_, i) => i !== index));
  }
```

**4e.** Update `clearDraft()` to also clear floating tasks. The current method body is:

```ts
  clearDraft(): void {
    localStorage.removeItem(this.DRAFT_KEY);
  }
```

Replace it with:

```ts
  clearDraft(): void {
    localStorage.removeItem(this.DRAFT_KEY);
    this.floatingTasksSignal.set([]);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd plnd_client && npx ng test --include="**/week-plan.service.spec.ts" --watch=false --browsers=ChromeHeadless 2>&1 | tail -20
```

Expected: all tests PASS, including the 4 new `floating task management` specs.

- [ ] **Step 6: Commit**

```bash
git add plnd_client/src/app/core/models/week-plan.ts \
        plnd_client/src/app/core/services/week-plan.service.ts \
        plnd_client/src/app/core/services/week-plan.service.spec.ts
git commit -m "feat(planning): add FloatingTask type and WeekPlanService floating task methods (#60)"
```

---

## Task 3: Rewrite PlanTasksStepComponent

**Files:**
- Rewrite: `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.ts`
- Rewrite: `plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.spec.ts`

- [ ] **Step 1: Write failing tests in `plan-tasks-step.spec.ts`**

Replace the entire contents of `plan-tasks-step.spec.ts` with:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PlanTasksStepComponent } from './plan-tasks-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { AddedEntry } from '../../../schedule/components/add-entry/add-entry';

describe('PlanTasksStepComponent', () => {
  let fixture: ComponentFixture<PlanTasksStepComponent>;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanTasksStepComponent, HttpClientTestingModule],
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    fixture = TestBed.createComponent(PlanTasksStepComponent);
    fixture.detectChanges();
  });

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should render one accordion section per horizon day', () => {
    const sections = fixture.nativeElement.querySelectorAll('.day-accordion');
    expect(sections.length).toBe(7);
  });

  it('should default all sections to open for a 7-day horizon', () => {
    const open = fixture.nativeElement.querySelectorAll('.day-accordion.open');
    expect(open.length).toBe(7);
  });

  it('should collapse a section when its header is clicked', () => {
    const header: HTMLElement = fixture.nativeElement.querySelector('.day-accordion__header');
    header.click();
    fixture.detectChanges();
    const open = fixture.nativeElement.querySelectorAll('.day-accordion.open');
    expect(open.length).toBe(6);
  });

  it('should re-expand a section when its header is clicked again', () => {
    const header: HTMLElement = fixture.nativeElement.querySelector('.day-accordion__header');
    header.click();
    fixture.detectChanges();
    header.click();
    fixture.detectChanges();
    const open = fixture.nativeElement.querySelectorAll('.day-accordion.open');
    expect(open.length).toBe(7);
  });

  it('onTaskAdded should call weekPlanService.addTask with correct fields for exercise', () => {
    spyOn(service, 'addTask');
    const entry: AddedEntry = { label: 'Morning run', type: 'exercise', duration: 30 };
    fixture.componentInstance.onTaskAdded('2026-03-24', entry);
    expect(service.addTask).toHaveBeenCalledWith(jasmine.objectContaining({
      date: '2026-03-24',
      title: 'Morning run',
      task_type: 'exercise',
      duration: 30,
      energy: 'medium',
    }));
  });

  it('onTaskAdded should set task_type to custom for non-exercise entries', () => {
    spyOn(service, 'addTask');
    const entry: AddedEntry = { label: 'Call dentist', type: 'appointment' };
    fixture.componentInstance.onTaskAdded('2026-03-25', entry);
    expect(service.addTask).toHaveBeenCalledWith(jasmine.objectContaining({
      task_type: 'custom',
    }));
  });

  it('onFloatingTaskAdded should call weekPlanService.addFloatingTask', () => {
    spyOn(service, 'addFloatingTask');
    const entry: AddedEntry = { label: 'Buy groceries', type: 'task' };
    fixture.componentInstance.onFloatingTaskAdded(entry);
    expect(service.addFloatingTask).toHaveBeenCalledWith(jasmine.objectContaining({
      title: 'Buy groceries',
      energy: 'medium',
      task_type: 'custom',
    }));
  });

  it('onFloatingTaskAdded should set task_type to exercise for exercise entries', () => {
    spyOn(service, 'addFloatingTask');
    const entry: AddedEntry = { label: '30 min yoga', type: 'exercise', duration: 30 };
    fixture.componentInstance.onFloatingTaskAdded(entry);
    expect(service.addFloatingTask).toHaveBeenCalledWith(jasmine.objectContaining({
      task_type: 'exercise',
      duration: 30,
    }));
  });

  it('should render floating tasks inside the floating panel', () => {
    service.addFloatingTask({ title: 'Unscheduled errand', energy: 'low', task_type: 'custom' });
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.floating-task-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Unscheduled errand');
  });

  it('should call weekPlanService.removeFloatingTask when floating remove button is clicked', () => {
    spyOn(service, 'removeFloatingTask');
    service.addFloatingTask({ title: 'Task to remove', energy: 'low', task_type: 'custom' });
    fixture.detectChanges();
    const btn: HTMLElement = fixture.nativeElement.querySelector('.floating-remove');
    btn.click();
    expect(service.removeFloatingTask).toHaveBeenCalledWith(0);
  });

  it('should render the floating panel with correct header text', () => {
    const panel: HTMLElement = fixture.nativeElement.querySelector('.floating-panel');
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('FLOATING TASKS');
    expect(panel.textContent).toContain('agent will schedule these');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd plnd_client && npx ng test --include="**/plan-tasks-step.spec.ts" --watch=false --browsers=ChromeHeadless 2>&1 | tail -40
```

Expected: multiple failures — `.day-accordion` not found (old template uses `.day-tasks-row`), `onTaskAdded is not a function`, `onFloatingTaskAdded is not a function`, `.floating-task-row` not found, `.floating-panel` not found.

- [ ] **Step 3: Rewrite `plan-tasks-step.ts`**

Replace the entire contents of `plan-tasks-step.ts` with:

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { PlannedTask } from '../../../../core/models/week-plan';
import { AddEntryComponent, AddedEntry } from '../../../schedule/components/add-entry/add-entry';

@Component({
  selector: 'app-plan-tasks-step',
  standalone: true,
  imports: [AddEntryComponent],
  template: `
    <div class="tasks-step">

      @for (day of horizonDays(); track day) {
        <div class="day-accordion" [class.open]="isExpanded(day)">

          <div class="day-accordion__header"
               role="button"
               tabindex="0"
               [attr.aria-expanded]="isExpanded(day)"
               (click)="toggleDay(day)"
               (keydown.enter)="toggleDay(day)"
               (keydown.space)="$event.preventDefault(); toggleDay(day)">
            <span class="day-name">{{ formatDayName(day) }}</span>
            <span class="day-date">{{ formatShortDate(day) }}</span>
            <span class="task-badge"
                  [class.zero]="(tasksByDay()[day]?.length ?? 0) === 0">
              {{ tasksByDay()[day]?.length ?? 0 }}
              {{ (tasksByDay()[day]?.length ?? 0) === 1 ? 'task' : 'tasks' }}
            </span>
            <span class="chevron">▾</span>
          </div>

          <div class="day-accordion__body">
            <div class="task-list">
              @for (task of (tasksByDay()[day] ?? []); track $index) {
                <div class="task-row">
                  <span class="task-title">{{ task.title }}</span>
                  <span class="energy-badge energy-{{ task.energy }}">
                    {{ task.energy === 'medium' ? 'med' : task.energy }}
                  </span>
                  <button type="button" class="task-remove"
                          (click)="removeTask(day, $index)">✕</button>
                </div>
              }
            </div>
            <div class="add-affordance">
              <app-add-entry (added)="onTaskAdded(day, $event)" />
            </div>
          </div>

        </div>
      }

      <div class="floating-panel">
        <div class="floating-panel__header">
          <span class="floating-title">FLOATING TASKS</span>
          <span class="floating-hint">agent will schedule these</span>
        </div>
        <div class="float-task-list">
          @for (task of weekPlanService.floatingTasks(); track $index) {
            <div class="floating-task-row">
              <span class="task-title">{{ task.title }}</span>
              <span class="floating-badge">floating</span>
              <button type="button" class="floating-remove"
                      (click)="removeFloatingTask($index)">✕</button>
            </div>
          }
        </div>
        <div class="float-add-affordance">
          <app-add-entry (added)="onFloatingTaskAdded($event)" />
        </div>
      </div>

    </div>
  `,
  styles: [`
    .tasks-step { display: flex; flex-direction: column; gap: 8px; }

    /* ── Accordion shell ─────────────────────────── */
    .day-accordion {
      background: var(--color-surface-white);
      border: 1.5px solid var(--color-border-row);
      border-radius: 10px;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .day-accordion.open { border-color: var(--color-accent); }

    /* ── Accordion header ────────────────────────── */
    .day-accordion__header {
      background: var(--color-surface-warm);
      border-bottom: 1.5px solid var(--color-border-meal);
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .day-accordion__header:focus-visible {
      outline: 2px solid var(--color-accent);
      outline-offset: -2px;
    }
    .day-accordion.open .day-accordion__header {
      background: var(--color-accent-light);
      border-bottom-color: var(--color-accent-border);
    }
    .day-name {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-text-primary);
    }
    .day-accordion.open .day-name { color: var(--color-accent-dark); }
    .day-date { font-size: 10px; color: var(--color-text-muted); }
    .task-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--color-accent-light);
      border: 1px solid var(--color-accent-border);
      color: var(--color-accent-dark);
    }
    .task-badge.zero {
      background: var(--color-surface-base);
      border-color: var(--color-border-row);
      color: var(--color-text-muted);
    }
    .chevron {
      margin-left: auto;
      font-size: 10px;
      color: var(--color-text-muted);
      transition: transform 0.2s;
    }
    .day-accordion.open .chevron { transform: rotate(180deg); }

    /* ── Accordion body (max-height transition) ──── */
    .day-accordion__body {
      overflow: hidden;
      max-height: 0;
      transition: max-height 0.25s ease-out;
    }
    .day-accordion.open .day-accordion__body {
      max-height: 800px;
      transition: max-height 0.3s ease-in;
    }

    /* ── Task rows ───────────────────────────────── */
    .task-row {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--color-border-row);
      font-size: 12px;
    }
    .task-list .task-row:last-child { border-bottom: none; }
    .task-title { flex: 1; color: var(--color-text-body); }

    /* ── Energy badges ───────────────────────────── */
    .energy-badge {
      font-size: 8px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .energy-low {
      background: rgba(74, 111, 165, 0.12);
      color: var(--color-energy-low);
      border: 1px solid rgba(74, 111, 165, 0.25);
    }
    .energy-medium {
      background: rgba(230, 126, 34, 0.12);
      color: var(--color-energy-medium);
      border: 1px solid rgba(230, 126, 34, 0.25);
    }
    .energy-high {
      background: rgba(192, 57, 43, 0.12);
      color: var(--color-energy-high);
      border: 1px solid rgba(192, 57, 43, 0.25);
    }

    /* ── Remove buttons ──────────────────────────── */
    .task-remove, .floating-remove {
      background: none;
      border: 1px solid transparent;
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 5px;
      border-radius: 4px;
      margin-left: auto;
    }
    .task-remove:hover, .floating-remove:hover {
      border-color: var(--color-border-row);
      color: var(--color-text-primary);
    }

    /* ── Add affordance ──────────────────────────── */
    .add-affordance { border-top: 1px dashed var(--color-border-row); }

    /* ── Floating panel ──────────────────────────── */
    .floating-panel {
      background: var(--color-surface-white);
      border: 1.5px solid var(--color-purple-border);
      border-radius: 10px;
      overflow: hidden;
      margin-top: 4px;
    }
    .floating-panel__header {
      background: var(--color-purple-light);
      border-bottom: 1.5px solid var(--color-purple-border);
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .floating-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-purple-dark);
    }
    .floating-hint {
      margin-left: auto;
      font-size: 10px;
      color: var(--color-purple);
      font-style: italic;
      opacity: 0.75;
    }
    .floating-task-row {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--color-border-row);
      font-size: 12px;
    }
    .float-task-list .floating-task-row:last-child { border-bottom: none; }
    .floating-badge {
      font-size: 8px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--color-purple-light);
      border: 1px solid var(--color-purple-border);
      color: var(--color-purple-dark);
      flex-shrink: 0;
    }
    .float-add-affordance { border-top: 1px dashed var(--color-purple-border); }
  `],
})
export class PlanTasksStepComponent {
  readonly weekPlanService = inject(WeekPlanService);

  readonly horizonDays = computed(() => this.weekPlanService.horizonDays());

  readonly tasksByDay = computed(() => {
    const byDay: Record<string, PlannedTask[]> = {};
    for (const task of this.weekPlanService.scheduledTasks()) {
      (byDay[task.date] ??= []).push(task);
    }
    return byDay;
  });

  private readonly expandedOverrides = signal<Record<string, boolean>>({});

  // Returns the expanded state for a day. Falls back to true when horizon ≤ 7 days.
  isExpanded(date: string): boolean {
    const overrides = this.expandedOverrides();
    if (date in overrides) return overrides[date];
    return this.horizonDays().length <= 7;
  }

  toggleDay(date: string): void {
    this.expandedOverrides.update(o => ({ ...o, [date]: !this.isExpanded(date) }));
  }

  formatDayName(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  }

  formatShortDate(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  removeTask(date: string, localIndex: number): void {
    const tasks = this.weekPlanService.scheduledTasks();
    const dayTasks = tasks.filter(t => t.date === date);
    const target = dayTasks[localIndex];
    const globalIndex = tasks.indexOf(target);
    if (globalIndex >= 0) this.weekPlanService.removeTask(globalIndex);
  }

  removeFloatingTask(index: number): void {
    this.weekPlanService.removeFloatingTask(index);
  }

  onTaskAdded(date: string, entry: AddedEntry): void {
    this.weekPlanService.addTask({
      date,
      title: entry.label,
      energy: 'medium',
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
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd plnd_client && npx ng test --include="**/plan-tasks-step.spec.ts" --watch=false --browsers=ChromeHeadless 2>&1 | tail -30
```

Expected: all 11 specs PASS.

- [ ] **Step 5: Run the full Angular test suite to check for regressions**

```bash
just test-ng-headless 2>&1 | tail -20
```

Expected: all tests PASS, no regressions in other step components.

- [ ] **Step 6: Run the full quality suite**

```bash
just verify 2>&1 | tail -30
```

Expected: clean run — Rust formatting, Clippy, TypeScript lint, and all tests pass.

- [ ] **Step 7: Commit**

```bash
git add plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.ts \
        plnd_client/src/app/features/planning/steps/plan-tasks-step/plan-tasks-step.spec.ts
git commit -m "feat(planning): redesign tasks & exercise step — accordion cards, inline AddEntry, floating tasks panel (#60)"
```
