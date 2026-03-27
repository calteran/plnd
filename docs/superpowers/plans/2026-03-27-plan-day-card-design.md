# Plan Day Card Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `PlanDayCardComponent` a full visual treatment — collapsed tile with header band and stat badges, animated expand/collapse revealing meals and tasks, hover/focus states — all driven by CSS custom property tokens.

**Architecture:** Three file changes: (1) add `align-items: flex-start` to the parent grid so expanded cards don't stretch siblings; (2) rewrite the card template with new semantic class names, always-rendered `.card-body` for CSS animation, and two new helper methods; (3) create a new `plan-day-card.scss` with all visual rules. No Angular animation module dependency — expand/collapse uses a CSS `max-height` transition.

**Tech Stack:** Angular 17+ standalone components, Angular `DatePipe` / `NgClass` / `TitleCasePipe`, SCSS with CSS custom properties from `_tokens.scss`, Jasmine/TestBed.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-grid-step.ts` | Modify | Add `align-items: flex-start` to `.day-grid` inline style |
| `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.ts` | Modify | Add `styleUrl`, rewrite template, add `energyClass()`/`energyLabel()` methods, add `DatePipe`/`NgClass` imports |
| `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.scss` | Create | All visual rules: card shell, header, stats, chevron, expanded body, hover/focus states, animation |
| `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.spec.ts` | Create | Component tests: DOM structure, toggle behavior, badge zero-class, energy class mapping |

---

## Task 1: Fix day-grid alignment in `plan-day-grid-step.ts`

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-grid-step.ts:20-25`

- [ ] **Step 1: Add `align-items: flex-start` to the `.day-grid` style**

Open `plan-day-grid-step.ts`. The current `styles` array at line 20 reads:

```typescript
  styles: [`
    .day-grid { display: flex; flex-wrap: wrap; gap: 1rem; }
    @media (max-width: 600px) {
      .day-grid { flex-direction: column; overflow-x: auto; flex-wrap: nowrap; }
    }
  `]
```

Change it to:

```typescript
  styles: [`
    .day-grid { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; }
    @media (max-width: 600px) {
      .day-grid { flex-direction: column; overflow-x: auto; flex-wrap: nowrap; }
    }
  `]
```

- [ ] **Step 2: Verify compilation**

```bash
just verify-build
```

Expected: no TypeScript or SCSS errors.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-grid-step.ts
git commit -m "fix(planning): align day-grid items to flex-start for independent card heights (#59)"
```

---

## Task 2: Create `plan-day-card.spec.ts` (write tests first)

**Files:**
- Create: `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.spec.ts`

- [ ] **Step 1: Create the test file**

Create `plan-day-card.spec.ts` with the full test suite below. These tests describe the behavior we're about to build; they will fail until Task 3 is complete.

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PlanDayCardComponent } from './plan-day-card';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanDayCardComponent', () => {
  let fixture: ComponentFixture<PlanDayCardComponent>;
  let service: WeekPlanService;

  function createComponent(date = '2026-03-31') {
    fixture = TestBed.createComponent(PlanDayCardComponent);
    fixture.componentRef.setInput('date', date);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanDayCardComponent, HttpClientTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-31', '2026-04-06');
  });

  it('should create', () => {
    createComponent();
    expect(fixture.componentInstance).toBeTruthy();
  });

  describe('collapsed state', () => {
    beforeEach(() => createComponent('2026-03-31'));

    it('should render the day name abbreviation', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.day-name')?.textContent?.trim()).toBe('Tue');
    });

    it('should render the short date', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.day-date')?.textContent?.trim()).toBe('Mar 31');
    });

    it('should render a .card-stats element', () => {
      expect(fixture.nativeElement.querySelector('.card-stats')).toBeTruthy();
    });

    it('should render two .stat-row elements', () => {
      const rows = fixture.nativeElement.querySelectorAll('.stat-row');
      expect(rows.length).toBe(2);
    });

    it('should render a .card-chevron element', () => {
      expect(fixture.nativeElement.querySelector('.card-chevron')).toBeTruthy();
    });

    it('should always render .card-body in the DOM (for CSS animation)', () => {
      expect(fixture.nativeElement.querySelector('.card-body')).toBeTruthy();
    });

    it('should NOT have .expanded class when collapsed', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      expect(card.classList.contains('expanded')).toBeFalse();
    });
  });

  describe('zero-value badge styling', () => {
    beforeEach(() => createComponent('2026-04-06')); // day with no tasks or meals added

    it('should apply .zero class to tasks badge when task count is 0', () => {
      const statVals = fixture.nativeElement.querySelectorAll('.stat-val');
      const tasksBadge: HTMLElement = statVals[0];
      expect(tasksBadge.classList.contains('zero')).toBeTrue();
    });

    it('should apply .zero class to meals badge when meal count is 0', () => {
      const statVals = fixture.nativeElement.querySelectorAll('.stat-val');
      const mealsBadge: HTMLElement = statVals[1];
      expect(mealsBadge.classList.contains('zero')).toBeTrue();
    });
  });

  describe('expand/collapse toggle', () => {
    beforeEach(() => createComponent());

    it('should add .expanded class to .day-card on click', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.click();
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBeTrue();
    });

    it('should remove .expanded class on second click', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.click();
      fixture.detectChanges();
      card.click();
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBeFalse();
    });
  });

  describe('energyClass() helper', () => {
    beforeEach(() => createComponent());

    it('returns "energy-low" for low', () => {
      expect(fixture.componentInstance.energyClass('low')).toBe('energy-low');
    });

    it('returns "energy-med" for medium', () => {
      expect(fixture.componentInstance.energyClass('medium')).toBe('energy-med');
    });

    it('returns "energy-high" for high', () => {
      expect(fixture.componentInstance.energyClass('high')).toBe('energy-high');
    });
  });

  describe('energyLabel() helper', () => {
    beforeEach(() => createComponent());

    it('returns "low" for low', () => {
      expect(fixture.componentInstance.energyLabel('low')).toBe('low');
    });

    it('returns "med" for medium', () => {
      expect(fixture.componentInstance.energyLabel('medium')).toBe('med');
    });

    it('returns "high" for high', () => {
      expect(fixture.componentInstance.energyLabel('high')).toBe('high');
    });
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
just test-ng-headless
```

Expected: multiple failures (`Cannot read properties of null`, `Expected false to be true`, etc.) — this confirms the tests are targeting behavior not yet implemented.

---

## Task 3: Rewrite `plan-day-card.ts` template and class

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.ts`

- [ ] **Step 1: Replace the full file contents**

Replace `plan-day-card.ts` with:

```typescript
import { Component, computed, inject, input } from '@angular/core';
import { DatePipe, NgClass, TitleCasePipe } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { EnergyLevel, MealSlot } from '../../../../core/models/week-plan';

const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

@Component({
  selector: 'app-plan-day-card',
  standalone: true,
  imports: [DatePipe, NgClass, TitleCasePipe],
  styleUrl: 'plan-day-card.scss',
  template: `
    <div
      class="day-card"
      [class.expanded]="expanded"
      (click)="toggle()"
      tabindex="0"
      (keydown.enter)="toggle()"
      (keydown.space)="$event.preventDefault(); toggle()"
    >
      <div class="card-header">
        <span class="day-name">{{ date() | date:'EEE' }}</span>
        <span class="day-date">{{ date() | date:'MMM d' }}</span>
      </div>
      <div class="card-stats">
        <div class="stat-row">
          <span class="stat-label">tasks</span>
          <span class="stat-val" [class.zero]="taskCount() === 0">{{ taskCount() }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">meals</span>
          <span class="stat-val" [class.zero]="mealCount() === 0">{{ mealCount() }}</span>
        </div>
      </div>
      <span class="card-chevron">▾</span>
      <div class="card-body">
        <div class="card-body-inner">
          <div>
            <div class="body-section-label">Meals</div>
            @for (slot of slots; track slot) {
              <div class="body-row">
                <span class="slot">{{ slot | titlecase }}</span>
                @if (getMeal(slot); as meal) {
                  <span class="val">{{ meal.title }}</span>
                } @else {
                  <span class="empty-val">—</span>
                }
              </div>
            }
          </div>
          <div>
            <div class="body-section-label">Tasks</div>
            @for (task of tasks(); track $index) {
              <div class="body-row">
                <span class="val">{{ task.title }}</span>
                <span class="energy-badge" [ngClass]="energyClass(task.energy)">
                  {{ energyLabel(task.energy) }}
                </span>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `
})
export class PlanDayCardComponent {
  readonly date = input.required<string>();

  private readonly weekPlanService = inject(WeekPlanService);
  expanded = false;
  readonly slots = MEAL_SLOTS;

  toggle(): void { this.expanded = !this.expanded; }

  readonly tasks = computed(() =>
    this.weekPlanService.scheduledTasks().filter(t => t.date === this.date())
  );
  readonly taskCount = computed(() => this.tasks().length);

  getMeal(slot: MealSlot) {
    return this.weekPlanService.scheduledMeals()[this.date()]?.[slot];
  }

  readonly mealCount = computed(() => this.slots.filter(s => this.getMeal(s)).length);

  energyClass(energy: EnergyLevel): string {
    return energy === 'medium' ? 'energy-med' : `energy-${energy}`;
  }

  energyLabel(energy: EnergyLevel): string {
    return energy === 'medium' ? 'med' : energy;
  }
}
```

- [ ] **Step 2: Run the tests — confirm they now pass (except SCSS-dependent ones)**

```bash
just test-ng-headless
```

Expected: all tests pass. The `.zero` class, `.expanded` toggle, and helper method tests should all be green. (Visual rendering tests aren't part of unit tests.)

- [ ] **Step 3: Commit**

```bash
git add plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.ts \
        plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.spec.ts
git commit -m "feat(planning): restructure PlanDayCardComponent template for styled card (#59)"
```

---

## Task 4: Create `plan-day-card.scss`

**Files:**
- Create: `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.scss`

- [ ] **Step 1: Create the SCSS file**

Create `plan-day-card.scss` with:

```scss
// ── Card shell ────────────────────────────────────────────────
.day-card {
  background: var(--color-surface-white);
  border: 1.5px solid var(--color-border-row);
  border-radius: 10px;
  min-width: 120px;
  max-width: 200px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:hover {
    border-color: var(--color-accent-border);
    box-shadow: 0 2px 8px rgba(217, 119, 6, 0.10);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  &.expanded {
    border-color: var(--color-accent);
    box-shadow: 0 2px 10px rgba(217, 119, 6, 0.14);
  }
}

// ── Card header ───────────────────────────────────────────────
.card-header {
  background: var(--color-surface-warm);
  border-bottom: 1.5px solid var(--color-border-meal);
  padding: 8px 11px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  user-select: none;

  .expanded & {
    background: var(--color-accent-light);
    border-bottom-color: var(--color-accent-border);
  }
}

.day-name {
  font-size: 11px;
  font-weight: 800;
  color: var(--color-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.06em;

  .expanded & {
    color: var(--color-accent-dark);
  }
}

.day-date {
  font-size: 10px;
  color: var(--color-text-muted);
}

// ── Stats (collapsed summary) ─────────────────────────────────
.card-stats {
  padding: 8px 11px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
}

.stat-label {
  color: var(--color-text-muted);
}

.stat-val {
  font-weight: 700;
  font-size: 9px;
  border-radius: 3px;
  padding: 1px 6px;
  background: var(--color-accent-light);
  border: 1px solid var(--color-accent-border);
  color: var(--color-accent-dark);

  &.zero {
    background: var(--color-surface-base);
    border-color: var(--color-border-row);
    color: var(--color-text-muted);
  }
}

// ── Chevron ───────────────────────────────────────────────────
.card-chevron {
  display: block;
  font-size: 10px;
  color: var(--color-text-muted);
  text-align: center;
  padding: 0 11px 6px;
  line-height: 1;
  transition: transform 0.2s;

  .expanded & {
    transform: rotate(180deg);
  }
}

// ── Expanded body ─────────────────────────────────────────────
.card-body {
  border-top: 1.5px solid var(--color-accent-border);
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.25s ease-out;

  .expanded & {
    max-height: 400px;
    transition: max-height 0.3s ease-in;
  }
}

.card-body-inner {
  padding: 10px 11px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

// ── Body sections ─────────────────────────────────────────────
.body-section-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.body-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid var(--color-border-row);
  font-size: 11px;

  &:last-child {
    border-bottom: none;
  }
}

.slot {
  font-size: 9px;
  color: var(--color-text-muted);
  min-width: 48px;
  flex-shrink: 0;
}

.val {
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: 11px;
  flex: 1;
}

.empty-val {
  color: var(--color-text-muted);
  font-style: italic;
  font-size: 11px;
  flex: 1;
}

// ── Energy badges ─────────────────────────────────────────────
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

.energy-med {
  background: rgba(230, 126, 34, 0.12);
  color: #c0632a;
  border: 1px solid rgba(230, 126, 34, 0.25);
}

.energy-high {
  background: rgba(192, 57, 43, 0.12);
  color: var(--color-energy-high);
  border: 1px solid rgba(192, 57, 43, 0.25);
}
```

- [ ] **Step 2: Run the full quality suite**

```bash
just verify
```

Expected: all checks pass — formatting, lint, build, and tests all green.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.scss
git commit -m "feat(planning): add PlanDayCardComponent styles — collapsed/expanded states (#59)"
```

---

## Task 5: Open PR

- [ ] **Step 1: Push the branch and open PR**

```bash
git push -u origin fix/planning-day-card-design-59
gh pr create \
  --title "feat(planning): design day grid step cards (#59)" \
  --body "$(cat <<'EOF'
## Summary

- Adds full visual treatment to \`PlanDayCardComponent\`: warm header band, stat badges (amber for non-zero, grey for zero), animated expand/collapse via CSS \`max-height\`, meals/tasks body with energy badges
- Fixes day-grid \`align-items: flex-start\` so expanded cards don't stretch siblings
- Keyboard-accessible (tabindex, Enter/Space toggle, focus-visible outline)
- Read-only body — edit affordances deferred to #65

## Test plan

- [ ] \`just verify\` passes cleanly
- [ ] Collapsed card shows day name (e.g. "Mon"), short date, task/meal counts
- [ ] Zero counts render with muted grey badge; non-zero render with amber badge
- [ ] Click expands card — amber border, rotated chevron, meals + tasks sections revealed
- [ ] Click again collapses — smooth \`max-height\` animation both directions
- [ ] Energy badges color-coded: blue (low), orange (med), red (high)
- [ ] Hover shows amber border + subtle shadow
- [ ] Keyboard: Tab focuses card, Enter/Space toggles, focus-visible outline appears

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Header: warm surface, amber border, day name uppercase 11px/800w, short date | Task 4 (`.card-header`, `.day-name`, `.day-date`) |
| Stats: two rows, muted label, small badge (9px, 3×6px padding, 3px radius) | Task 4 (`.card-stats`, `.stat-row`, `.stat-val`) |
| Non-zero badge: amber accent; zero badge: quiet grey | Task 3 ([class.zero]), Task 4 (`.stat-val.zero`) |
| Chevron ▾, rotates 180° on expand | Task 3 (template), Task 4 (`.card-chevron`) |
| Width: min 120px, max 200px | Task 4 (`.day-card`) |
| Expand: amber border + header background | Task 4 (`.expanded &` rules) |
| Meals section: slot label + meal title or em-dash | Task 3 (template), Task 4 (`.slot`, `.val`, `.empty-val`) |
| Tasks section: title + energy badge (blue/orange/red) | Task 3 (`energyClass()`), Task 4 (`.energy-*`) |
| Animation: max-height 0→400px, ease-out closing / ease-in opening | Task 4 (`.card-body`, `.expanded .card-body`) |
| Chevron rotate transition 0.2s | Task 4 (`.card-chevron`) |
| Hover: accent border + box-shadow | Task 4 (`.day-card:hover`) |
| Focus-visible: 2px accent outline | Task 4 (`.day-card:focus-visible`) |
| Grid align-items: flex-start | Task 1 |
| Keyboard accessibility (tabindex, Enter/Space) | Task 3 (template) |

All requirements covered. No placeholders. Types consistent throughout (`EnergyLevel` used in `energyClass()`/`energyLabel()` signature).
