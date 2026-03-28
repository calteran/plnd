# Meals Step Grid Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `PlanMealsStepComponent` as a day × slot CSS grid with ghost icon buttons, four cell interaction states, and implicit acceptance (advancing the wizard = accepting all pending suggestions).

**Architecture:** The meals step holds all interaction state locally (editing cell, re-suggest offsets) and writes only confirmed decisions to `WeekPlanService`. Implicit acceptance is resolved inside `WeekPlanService.buildCommitRequest` — it iterates over all horizon days × standard slots, includes `getMockSuggestion` for any slot with no explicit entry, and filters out the `__skipped__` sentinel. The meals step component itself is a single `.ts` file with inline styles; no new files are created.

**Tech Stack:** Angular 19 standalone components, Angular signals (`signal`, `computed`, `WritableSignal`), CSS Grid, `WeekPlanService` (`setMeal`, `clearMeal`, `scheduledMeals`), `getMockSuggestion` / `MOCK_MEAL_SUGGESTIONS` from `week-plan.ts`.

**Branch:** `feat/61-meals-step-grid`

---

## File Map

| File | Change |
|---|---|
| `plnd_client/src/app/core/services/week-plan.service.ts` | Add `getMockSuggestion` import; rewrite `buildCommitRequest` to resolve implicit acceptance and filter `__skipped__` |
| `plnd_client/src/app/core/services/week-plan.service.spec.ts` | Add tests for new `buildCommitRequest` behaviour |
| `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.ts` | Update `mealCoverage()` — pending slots now count as covered |
| `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.spec.ts` | Add tests for updated `mealCoverage()` |
| `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts` | Full rewrite — grid template, 4 cell states, ghost buttons, inline input |
| `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.spec.ts` | Full rewrite — new grid/slot/state tests |

---

## Task 1: Service — tests for implicit acceptance and skip sentinel

**Files:**
- Test: `plnd_client/src/app/core/services/week-plan.service.spec.ts`

- [ ] **Step 1: Add three tests to `week-plan.service.spec.ts`**

  Open the file and add these three `it` blocks inside the existing `describe('WeekPlanService', ...)` block, after the existing tests. The file already imports `TestBed`, `HttpClientTestingModule`, `HttpTestingController`, and `WeekPlanService`.

  Add `PostSchedulePlanRequest` to the import from `week-plan` at the top of the spec file, then add the three tests:

  ```ts
  // Add to imports at top of file:
  import { PostSchedulePlanRequest } from '../models/week-plan';
  ```

  ```ts
  it('buildCommitRequest includes mock suggestion for a pending (no-entry) slot', () => {
    service.initSession('2026-03-24', '2026-03-24'); // single day
    // No explicit meal set — all slots are pending
    service.commitPlan('task-1').subscribe();
    const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
    const body = req.request.body as PostSchedulePlanRequest;
    const breakfast = body.entries.find(
      e => e.date === '2026-03-24' && e.after_milepost === 'breakfast',
    );
    expect(breakfast).toBeTruthy();
    expect(breakfast!.title).toBeTruthy(); // mock suggestion title present
    expect(breakfast!.task_type).toBe('meal');
    req.flush({ committed: 3, planning_task_status: 'completed' });
  });

  it('buildCommitRequest excludes slots with __skipped__ sentinel', () => {
    service.initSession('2026-03-24', '2026-03-24');
    service.setMeal('2026-03-24', 'breakfast', { type: 'mock', title: '__skipped__' });
    service.commitPlan('task-1').subscribe();
    const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
    const body = req.request.body as PostSchedulePlanRequest;
    const breakfast = body.entries.find(
      e => e.date === '2026-03-24' && e.after_milepost === 'breakfast',
    );
    expect(breakfast).toBeUndefined();
    req.flush({ committed: 2, planning_task_status: 'completed' });
  });

  it('buildCommitRequest includes user_meal entries as-is', () => {
    service.initSession('2026-03-24', '2026-03-24');
    service.setMeal('2026-03-24', 'lunch', { type: 'user_meal', title: 'Greek yogurt' });
    service.commitPlan('task-1').subscribe();
    const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
    const body = req.request.body as PostSchedulePlanRequest;
    const lunch = body.entries.find(
      e => e.date === '2026-03-24' && e.after_milepost === 'lunch',
    );
    expect(lunch).toBeTruthy();
    expect(lunch!.task_ref_type).toBe('user_meal');
    expect(lunch!.title).toBeUndefined(); // title omitted for user_meal
    req.flush({ committed: 3, planning_task_status: 'completed' });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  just test-ng-headless
  ```

  Expected: the three new tests fail because `buildCommitRequest` does not yet resolve pending slots or filter sentinels.

---

## Task 2: Service — implement implicit acceptance in `buildCommitRequest`

**Files:**
- Modify: `plnd_client/src/app/core/services/week-plan.service.ts`

- [ ] **Step 1: Add `getMockSuggestion` to the import from `week-plan`**

  Find this line in `week-plan.service.ts`:

  ```ts
  import {
    CarryoverDecision, MealSlot, PlanDraftShape,
    PlanEntryRequest, PlannedMeal, PlannedTask, FloatingTask,
    PostSchedulePlanRequest, PostSchedulePlanResponse,
    PlanStatusResponse, SchedulePeriodResponse,
  } from '../models/week-plan';
  ```

  Replace with:

  ```ts
  import {
    CarryoverDecision, MealSlot, PlanDraftShape,
    PlanEntryRequest, PlannedMeal, PlannedTask, FloatingTask,
    PostSchedulePlanRequest, PostSchedulePlanResponse,
    PlanStatusResponse, SchedulePeriodResponse, getMockSuggestion,
  } from '../models/week-plan';
  ```

- [ ] **Step 2: Rewrite `buildCommitRequest`**

  Find the `private buildCommitRequest(...)` method (lines 241–280 in the current file) and replace it entirely:

  ```ts
  private buildCommitRequest(taskId: string, replace: boolean): PostSchedulePlanRequest {
    const meals = this.scheduledMealsSignal();
    const tasks = this.scheduledTasksSignal();
    const entries: PlanEntryRequest[] = [];
    const STANDARD_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

    // Resolve all horizon day × standard slot combinations.
    // Pending (no entry) → implicit acceptance via getMockSuggestion.
    // __skipped__ sentinel → omit from request.
    for (const date of this.horizonDays()) {
      for (const slot of STANDARD_SLOTS) {
        const meal = meals[date]?.[slot];
        if (meal?.title === '__skipped__') continue;
        const resolved: PlannedMeal = meal ?? { type: 'mock', title: getMockSuggestion(date, slot) };
        entries.push({
          date,
          task_type: 'meal',
          task_ref_id: resolved.type === 'user_meal' ? resolved.id : undefined,
          task_ref_type: resolved.type === 'user_meal' ? 'user_meal' : undefined,
          title: resolved.type === 'mock' ? resolved.title : undefined,
          scheduled_start: slotDefaultTime(slot),
          after_milepost: slot,
        });
      }
    }

    for (const task of tasks) {
      entries.push({
        date: task.date,
        task_type: task.task_type ?? 'custom',
        task_ref_id: task.task_ref_id,
        task_ref_type: task.task_ref_type,
        title: task.title,
        scheduled_start: task.scheduled_start ?? '09:00',
      });
    }

    return {
      plan_start: this.planStartSignal(),
      plan_end: this.planEndSignal(),
      planning_task_id: taskId,
      entries,
      replace: replace || undefined,
      carryover_decisions: this.carryoverDecisionsSignal(),
    };
  }
  ```

- [ ] **Step 3: Run tests to verify they pass**

  ```bash
  just test-ng-headless
  ```

  Expected: the three new service tests pass; all existing service tests still pass.

- [ ] **Step 4: Commit**

  ```bash
  git add plnd_client/src/app/core/services/week-plan.service.ts \
          plnd_client/src/app/core/services/week-plan.service.spec.ts
  git commit -m "feat(planning): resolve implicit meal acceptance in buildCommitRequest (#61)"
  ```

---

## Task 3: Confirm step — update `mealCoverage` for new acceptance model

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.ts`
- Modify: `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.spec.ts`

- [ ] **Step 1: Add two tests to `plan-confirm-step.spec.ts`**

  Add inside the existing `describe` block after the existing tests:

  ```ts
  it('should count pending slots (no entry) as fully covered', () => {
    // No meals explicitly set — all pending slots are implicitly accepted
    fixture.detectChanges();
    expect(fixture.componentInstance.mealCoverage()).toBe(100);
  });

  it('should exclude __skipped__ slots from mealCoverage', () => {
    service.setMeal('2026-03-24', 'breakfast', { type: 'mock', title: '__skipped__' });
    fixture.detectChanges();
    // 7 days × 3 slots = 21 total; 1 skipped → 20 covered
    const expected = Math.round((20 / 21) * 100);
    expect(fixture.componentInstance.mealCoverage()).toBe(expected);
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  just test-ng-headless
  ```

  Expected: both new confirm-step tests fail because `mealCoverage()` currently counts only explicit entries (showing 0% when no meals are set).

- [ ] **Step 3: Update `mealCoverage` in `plan-confirm-step.ts`**

  Find the `readonly mealCoverage = computed(...)` block and replace it:

  ```ts
  readonly mealCoverage = computed(() => {
    const days = this.weekPlanService.horizonDays();
    if (days.length === 0) return 0;
    const meals = this.weekPlanService.scheduledMeals();
    // Pending slots (no entry) = implicitly accepted = covered.
    // Only the __skipped__ sentinel reduces coverage.
    const covered = days.reduce((acc, d) => {
      const daySlots = meals[d] ?? {};
      return acc + MEAL_SLOTS.filter(s => {
        const entry = daySlots[s];
        return !entry || entry.title !== '__skipped__';
      }).length;
    }, 0);
    return Math.round((covered / (days.length * MEAL_SLOTS.length)) * 100);
  });
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  just test-ng-headless
  ```

  Expected: both new confirm-step tests pass; existing confirm-step tests still pass.

- [ ] **Step 5: Commit**

  ```bash
  git add plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.ts \
          plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.spec.ts
  git commit -m "feat(planning): update mealCoverage to count pending slots as covered (#61)"
  ```

---

## Task 4: Meals step — write new tests (they will fail)

**Files:**
- Rewrite: `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.spec.ts`

- [ ] **Step 1: Replace the entire spec file**

  ```ts
  import { ComponentFixture, TestBed } from '@angular/core/testing';
  import { HttpClientTestingModule } from '@angular/common/http/testing';
  import { PlanMealsStepComponent } from './plan-meals-step';
  import { WeekPlanService } from '../../../../core/services/week-plan.service';

  describe('PlanMealsStepComponent', () => {
    let fixture: ComponentFixture<PlanMealsStepComponent>;
    let service: WeekPlanService;
    let component: PlanMealsStepComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [PlanMealsStepComponent, HttpClientTestingModule],
      }).compileComponents();
      service = TestBed.inject(WeekPlanService);
      // Mon 2026-03-23 through Fri 2026-03-27 → 5 days
      service.initSession('2026-03-23', '2026-03-27');
      fixture = TestBed.createComponent(PlanMealsStepComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should create', () => expect(component).toBeTruthy());

    it('should render one .gc cell for each day × slot (5 days × 3 slots = 15)', () => {
      const cells = fixture.nativeElement.querySelectorAll('.gc');
      expect(cells.length).toBe(15);
    });

    it('should render 5 day column headers', () => {
      const headers = fixture.nativeElement.querySelectorAll('.cell-day-header');
      expect(headers.length).toBe(5);
    });

    it('should render a slot row label for each slot', () => {
      const labels = fixture.nativeElement.querySelectorAll('.slot-lbl');
      expect(labels.length).toBe(3);
      const text = Array.from(labels).map((l: any) => l.textContent.trim().toLowerCase());
      expect(text).toContain('breakfast');
      expect(text).toContain('lunch');
      expect(text).toContain('dinner');
    });

    it('should display a suggestion text in a pending cell', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      const text = firstCell.querySelector('.gc-text');
      expect(text).toBeTruthy();
      expect(text!.textContent!.trim().length).toBeGreaterThan(0);
    });

    it('should display ✏️ Pick and 🔀 Suggest buttons in a pending cell', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
      expect(firstCell.querySelector('.gc-suggest')).toBeTruthy();
    });

    it('should display the × skip button in a pending cell', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      expect(firstCell.querySelector('.gc-x')).toBeTruthy();
    });

    it('should apply .skipped-g and show skip text when × is clicked', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(firstCell.classList.contains('skipped-g')).toBeTrue();
      expect(firstCell.querySelector('.gc-text.skip-t')).toBeTruthy();
      expect(firstCell.querySelector('.gc-undo')).toBeTruthy();
    });

    it('should restore pending state when undo is clicked on a skipped cell', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
      fixture.detectChanges();
      (firstCell.querySelector('.gc-undo') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(firstCell.classList.contains('skipped-g')).toBeFalse();
      expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
    });

    it('should enter editing state and show .mock-input when ✏️ Pick is clicked', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(firstCell.classList.contains('gc-editing')).toBeTrue();
      expect(firstCell.querySelector('.mock-input')).toBeTruthy();
      expect(firstCell.querySelector('.input-hint')).toBeTruthy();
    });

    it('should call setMeal with user_meal on Enter key and exit editing', () => {
      spyOn(service, 'setMeal');
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
      fixture.detectChanges();
      const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
      input.value = 'Greek yogurt';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(service.setMeal).toHaveBeenCalledWith(
        '2026-03-23', 'breakfast', { type: 'user_meal', title: 'Greek yogurt' },
      );
      expect(firstCell.classList.contains('gc-editing')).toBeFalse();
    });

    it('should not call setMeal and should exit editing on Escape key', () => {
      spyOn(service, 'setMeal');
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
      fixture.detectChanges();
      const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(service.setMeal).not.toHaveBeenCalled();
      expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
    });

    it('should show .custom-g state when a user_meal is already set', () => {
      service.setMeal('2026-03-23', 'breakfast', { type: 'user_meal', title: 'Greek yogurt' });
      fixture.detectChanges();
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      expect(firstCell.classList.contains('custom-g')).toBeTrue();
      const customText = firstCell.querySelector('.gc-text.custom-t');
      expect(customText).toBeTruthy();
      expect(customText!.textContent!.trim()).toBe('Greek yogurt');
      expect(firstCell.querySelector('.gc-edit-custom')).toBeTruthy();
    });

    it('should change suggestion text when 🔀 Suggest is clicked', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      const before = firstCell.querySelector('.gc-text')!.textContent!.trim();
      (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
      fixture.detectChanges();
      const after = firstCell.querySelector('.gc-text')!.textContent!.trim();
      expect(after).not.toBe(before);
    });

    it('should pre-fill edit input with existing custom meal title', () => {
      service.setMeal('2026-03-23', 'breakfast', { type: 'user_meal', title: 'Overnight oats' });
      fixture.detectChanges();
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-edit-custom') as HTMLButtonElement).click();
      fixture.detectChanges();
      const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
      expect(input.value).toBe('Overnight oats');
    });

    it('should clear custom meal back to pending when × is clicked in custom state', () => {
      spyOn(service, 'clearMeal');
      service.setMeal('2026-03-23', 'breakfast', { type: 'user_meal', title: 'Overnight oats' });
      fixture.detectChanges();
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(service.clearMeal).toHaveBeenCalledWith('2026-03-23', 'breakfast');
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  just test-ng-headless
  ```

  Expected: most new tests fail because the component still uses the old flat-list template (no `.gc`, `.gc-pick`, `.gc-suggest`, `.gc-x`, `.gc-editing`, `.skipped-g`, `.custom-g` classes).

---

## Task 5: Meals step — rewrite component

**Files:**
- Rewrite: `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts`

- [ ] **Step 1: Replace the entire component file**

  ```ts
  import { Component, computed, inject, signal, ViewChild, ElementRef } from '@angular/core';
  import { WeekPlanService } from '../../../../core/services/week-plan.service';
  import {
    MealSlot, PlannedMeal, getMockSuggestion, MOCK_MEAL_SUGGESTIONS,
  } from '../../../../core/models/week-plan';

  const STANDARD_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];
  const SLOT_LABELS: Record<string, string> = {
    breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
  };

  @Component({
    selector: 'app-plan-meals-step',
    standalone: true,
    imports: [],
    template: `
      <div class="plan-meals-wrapper">
        <div class="meals-grid" [style.grid-template-columns]="gridColumns()">

          <!-- Header row: empty corner + one day header per column -->
          <div></div>
          @for (day of horizonDays(); track day) {
            <div class="cell-day-header">
              <span class="day-name">{{ formatDayName(day) }}</span>
              <span class="day-date">{{ formatDayDate(day) }}</span>
            </div>
          }

          <!-- One row per meal slot -->
          @for (slot of slots; track slot) {
            <div class="cell-slot-label">
              <span class="slot-lbl">{{ slotLabel(slot) }}</span>
            </div>
            @for (day of horizonDays(); track day) {
              <div class="gc"
                   [class.custom-g]="isCustom(day, slot)"
                   [class.skipped-g]="isSkipped(day, slot)"
                   [class.gc-editing]="isCellEditing(day, slot)">

                @if (isSkipped(day, slot)) {
                  <span class="gc-text skip-t">— skipped</span>
                  <div class="gc-actions">
                    <button class="gc-undo" type="button"
                            (click)="undoSkip(day, slot)">undo</button>
                  </div>

                } @else if (isCellEditing(day, slot)) {
                  <input #mealInput
                         class="mock-input"
                         type="text"
                         [value]="editingValue"
                         (keydown.enter)="confirmEdit(day, slot, mealInput.value)"
                         (keydown.escape)="cancelEdit()">
                  <span class="input-hint">Enter · Esc to cancel</span>

                } @else if (isCustom(day, slot)) {
                  <button class="gc-x" type="button"
                          data-tip="Clear meal"
                          (click)="clearCustom(day, slot)">×</button>
                  <span class="gc-text custom-t">{{ getMeal(day, slot)!.title }}</span>
                  <div class="gc-actions">
                    <button class="gc-edit-custom" type="button"
                            (click)="startEdit(day, slot)">✏️ edit</button>
                  </div>

                } @else {
                  <button class="gc-x" type="button"
                          data-tip="Skip this meal"
                          (click)="skipSlot(day, slot)">×</button>
                  <span class="gc-text">{{ getSuggestion(day, slot) }}</span>
                  <div class="gc-actions">
                    <button class="gc-pick" type="button"
                            data-tip="Pick your own meal"
                            (click)="startEdit(day, slot)">✏️</button>
                    <button class="gc-suggest" type="button"
                            data-tip="Try a different suggestion"
                            (click)="reSuggest(day, slot)">🔀</button>
                  </div>
                }

              </div>
            }
          }

        </div>
      </div>
    `,
    styles: [`
      :host { display: block; }

      .plan-meals-wrapper { overflow-x: auto; padding-bottom: 8px; }

      .meals-grid {
        display: grid;
        gap: 5px;
        min-width: 360px;
      }

      /* ── Day column headers — accordion band style ── */
      .cell-day-header {
        background: var(--color-surface-warm);
        border-bottom: 2px solid var(--color-border-meal);
        border-radius: 8px 8px 0 0;
        padding: 7px 8px 6px;
        text-align: center;
      }
      .day-name {
        font-size: 11px; font-weight: 800; text-transform: uppercase;
        letter-spacing: 0.07em; color: var(--color-text-primary); display: block;
      }
      .day-date {
        font-size: 9px; color: var(--color-text-muted); display: block; margin-top: 1px;
      }

      /* ── Slot row labels ── */
      .cell-slot-label {
        display: flex; align-items: center; justify-content: flex-end; padding-right: 8px;
      }
      .slot-lbl {
        font-size: 9px; font-weight: 800; text-transform: uppercase;
        letter-spacing: 0.06em; color: var(--color-text-muted); text-align: right;
      }

      /* ── CSS-only tooltip ── */
      [data-tip] { position: relative; }
      [data-tip]:hover::after {
        content: attr(data-tip);
        position: absolute; bottom: calc(100% + 5px); left: 50%; transform: translateX(-50%);
        background: #1a1a18; color: #fff; font-size: 10px; white-space: nowrap;
        padding: 3px 7px; border-radius: 4px; pointer-events: none; z-index: 10;
      }
      [data-tip]:hover::before {
        content: ''; position: absolute; bottom: calc(100% + 1px);
        left: 50%; transform: translateX(-50%);
        border: 4px solid transparent; border-top-color: #1a1a18;
        pointer-events: none; z-index: 10;
      }

      /* ── Cell shell ── */
      .gc {
        background: var(--color-surface-white);
        border: 1px solid var(--color-border-row);
        border-radius: 7px;
        padding: 7px 8px 6px;
        display: flex; flex-direction: column; gap: 0;
        min-height: 68px; position: relative; box-sizing: border-box;
      }
      .gc.custom-g  { border-color: var(--color-accent-border); background: var(--color-accent-light); }
      .gc.skipped-g { background: var(--color-surface-base); opacity: 0.45; }
      .gc.gc-editing {
        border-color: var(--color-accent-border);
        box-shadow: 0 0 0 2px var(--color-accent-light);
      }

      /* Skip / clear corner button */
      .gc-x {
        position: absolute; top: 4px; right: 5px;
        background: none; border: none; padding: 0;
        font-size: 11px; color: var(--color-text-muted);
        cursor: pointer; opacity: 0.25; line-height: 1;
        width: 15px; height: 15px; display: flex; align-items: center; justify-content: center;
        border-radius: 3px;
      }
      .gc-x:hover { opacity: 0.6; }

      /* Meal suggestion / custom text */
      .gc-text {
        font-size: 11px; color: var(--color-text-body); font-style: italic; opacity: 0.75;
        line-height: 1.3; flex: 1; padding-right: 14px; margin-bottom: 5px;
      }
      .gc-text.custom-t {
        color: var(--color-accent-dark); font-weight: 600; font-style: normal; opacity: 1;
      }
      .gc-text.skip-t {
        color: var(--color-text-muted); font-size: 10px; font-style: italic;
      }

      /* Ghost action buttons row */
      .gc-actions { display: flex; gap: 4px; }
      .gc-pick,
      .gc-suggest {
        flex: 1;
        background: transparent;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 5px; padding: 3px 0;
        font-size: 12px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        color: var(--color-text-muted);
        transition: background 0.12s, border-color 0.12s;
      }
      .gc-pick:hover {
        background: var(--color-accent-light);
        border-color: var(--color-accent-border);
      }
      .gc-suggest:hover {
        background: var(--color-surface-base);
        border-color: var(--color-border-row);
      }

      /* Custom meal edit button */
      .gc-edit-custom {
        background: transparent; border: 1px solid rgba(217, 119, 6, 0.2);
        border-radius: 5px; padding: 3px 7px;
        font-size: 10px; color: var(--color-accent-dark);
        cursor: pointer; opacity: 0.75; align-self: flex-end;
        transition: opacity 0.1s;
      }
      .gc-edit-custom:hover { opacity: 1; }

      /* Undo skip */
      .gc-undo {
        font-size: 9px; color: var(--color-text-muted); background: none; border: none;
        text-decoration: underline dotted; cursor: pointer; padding: 0; align-self: flex-end;
      }

      /* Inline edit input */
      .mock-input {
        font-size: 12px; color: var(--color-text-primary);
        border: none; border-bottom: 1.5px solid var(--color-accent-border);
        outline: none; padding: 1px 0; background: transparent;
        width: 100%; font-family: inherit; flex: 1; margin-bottom: 4px;
      }
      .input-hint { font-size: 9px; color: var(--color-text-muted); font-style: italic; }
    `],
  })
  export class PlanMealsStepComponent {
    private readonly weekPlanService = inject(WeekPlanService);

    @ViewChild('mealInput') private mealInput?: ElementRef<HTMLInputElement>;

    readonly slots = STANDARD_SLOTS;
    readonly horizonDays = computed(() => this.weekPlanService.horizonDays());
    readonly gridColumns = computed(
      () => `68px repeat(${this.horizonDays().length}, 1fr)`,
    );

    /** Tracks which cell (if any) has its inline text input open. */
    readonly editingCell = signal<{ date: string; slot: MealSlot } | null>(null);
    /** Current value in the open text input. */
    editingValue = '';
    /** Per-cell offset for cycling through mock suggestions without persisting them. */
    private readonly suggestOffsets = signal<Record<string, number>>({});

    // ── Formatters ────────────────────────────────────────────

    formatDayName(date: string): string {
      return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    }

    formatDayDate(date: string): string {
      return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric',
      });
    }

    slotLabel(slot: MealSlot): string {
      return SLOT_LABELS[slot];
    }

    // ── Cell state queries ─────────────────────────────────────

    getMeal(date: string, slot: MealSlot): PlannedMeal | undefined {
      return this.weekPlanService.scheduledMeals()[date]?.[slot];
    }

    isSkipped(date: string, slot: MealSlot): boolean {
      return this.getMeal(date, slot)?.title === '__skipped__';
    }

    isCustom(date: string, slot: MealSlot): boolean {
      return this.getMeal(date, slot)?.type === 'user_meal';
    }

    isCellEditing(date: string, slot: MealSlot): boolean {
      const e = this.editingCell();
      return e?.date === date && e?.slot === slot;
    }

    /**
     * Returns the current suggestion for a pending cell, rotating through
     * MOCK_MEAL_SUGGESTIONS by the per-cell offset (incremented on 🔀 click).
     */
    getSuggestion(date: string, slot: MealSlot): string {
      const key = `${date}:${slot}`;
      const offset = this.suggestOffsets()[key] ?? 0;
      const baseIdx = MOCK_MEAL_SUGGESTIONS.indexOf(getMockSuggestion(date, slot));
      return MOCK_MEAL_SUGGESTIONS[(baseIdx + offset) % MOCK_MEAL_SUGGESTIONS.length];
    }

    // ── Actions ───────────────────────────────────────────────

    startEdit(date: string, slot: MealSlot): void {
      const existing = this.getMeal(date, slot);
      this.editingValue = existing?.type === 'user_meal' ? existing.title : '';
      this.editingCell.set({ date, slot });
      // Defer focus until Angular has rendered the input element.
      setTimeout(() => this.mealInput?.nativeElement.focus());
    }

    confirmEdit(date: string, slot: MealSlot, value: string): void {
      const trimmed = value.trim();
      if (trimmed) {
        this.weekPlanService.setMeal(date, slot, { type: 'user_meal', title: trimmed });
      }
      this.editingCell.set(null);
      this.editingValue = '';
    }

    cancelEdit(): void {
      this.editingCell.set(null);
      this.editingValue = '';
    }

    skipSlot(date: string, slot: MealSlot): void {
      this.weekPlanService.setMeal(date, slot, { type: 'mock', title: '__skipped__' });
    }

    undoSkip(date: string, slot: MealSlot): void {
      this.weekPlanService.clearMeal(date, slot);
    }

    clearCustom(date: string, slot: MealSlot): void {
      this.weekPlanService.clearMeal(date, slot);
    }

    /** Cycles to the next mock suggestion for a pending cell (local state only, not persisted). */
    reSuggest(date: string, slot: MealSlot): void {
      const key = `${date}:${slot}`;
      this.suggestOffsets.update(o => ({
        ...o,
        [key]: ((o[key] ?? 0) + 1) % MOCK_MEAL_SUGGESTIONS.length,
      }));
    }
  }
  ```

- [ ] **Step 2: Run tests to verify they pass**

  ```bash
  just test-ng-headless
  ```

  Expected: all 15 new meals-step tests pass; no regressions elsewhere.

- [ ] **Step 3: Run the full quality suite**

  ```bash
  just verify
  ```

  Expected: lint, type-check, build, and tests all pass cleanly.

- [ ] **Step 4: Commit**

  ```bash
  git add plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts \
          plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.spec.ts
  git commit -m "feat(planning): redesign meals step as day/slot grid (#61)"
  ```

---

## Task 6: Open pull request

- [ ] **Step 1: Push branch and open PR**

  ```bash
  git push -u origin feat/61-meals-step-grid
  gh pr create \
    --title "feat(planning): redesign meals step as day/slot grid (#61)" \
    --body "$(cat <<'EOF'
  ## Summary
  - Rewrites `PlanMealsStepComponent` as a CSS day × slot grid (days as columns, Breakfast/Lunch/Dinner as rows)
  - Replaces the explicit Accept/Skip model with implicit acceptance — advancing the wizard accepts all pending suggestions; ghost ✏️ Pick / 🔀 Suggest / × Skip buttons provide overrides
  - Updates `WeekPlanService.buildCommitRequest` to resolve pending slots via `getMockSuggestion` at submission time and filter the `__skipped__` sentinel
  - Updates `mealCoverage()` in the confirm step to count pending slots as covered

  ## Test plan
  - [ ] `just test-ng-headless` passes with 15 new meals-step tests + service + confirm-step tests
  - [ ] `just verify` passes clean (lint, type-check, build, tests)
  - [ ] Manual smoke: open the planning wizard, navigate to the Meals step, verify grid renders, test Pick/Suggest/Skip/undo interactions, advance to confirm and verify submission

  Closes #61

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```
