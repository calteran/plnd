# Confirm Step Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `PlanConfirmStepComponent` to use a tinted completion banner, scaled-down stat values, a full-width solid CTA, and a styled error container — matching the visual language of the other redesigned wizard steps.

**Architecture:** Single-file change — template and styles only, plus one new `formatWeekDate()` helper method. All signal logic and the `finish()` method are unchanged. Tests are updated first (TDD) to target the new DOM structure.

**Tech Stack:** Angular 17+ standalone components, CSS custom properties (`--color-*` tokens), Jasmine/Karma via `just test-ng-headless`.

---

## File Map

| File | Action |
|------|--------|
| `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.spec.ts` | Modify — add structure tests for banner, subtitle, and styled error |
| `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.ts` | Modify — replace template and styles; add `formatWeekDate()` |

---

### Task 1: Write failing tests for the new DOM structure

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.spec.ts`

- [ ] **Step 1: Add structure tests after the existing "should show summary stats" test**

Replace the contents of `plan-confirm-step.spec.ts` with:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { PlanConfirmStepComponent } from './plan-confirm-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { SKIP_SENTINEL } from '../../../../core/models/week-plan';

describe('PlanConfirmStepComponent', () => {
  let fixture: ComponentFixture<PlanConfirmStepComponent>;
  let httpMock: HttpTestingController;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanConfirmStepComponent, HttpClientTestingModule, RouterTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlanConfirmStepComponent);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should show Finish Week Plan button', () => {
    const btn = fixture.nativeElement.querySelector('.btn-finish');
    expect(btn).toBeTruthy();
  });

  it('should show summary stats', () => {
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('7'); // 7 days planned
  });

  it('should call commitPlan on finish click', () => {
    spyOn(service, 'commitPlan').and.returnValue(
      of({ committed: 0, planning_task_status: 'completed' })
    );
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-finish');
    btn.click();
    expect(service.commitPlan).toHaveBeenCalled();
  });

  it('should count pending slots (no entry) as fully covered', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.mealCoverage()).toBe(100);
  });

  it('should exclude __skipped__ slots from mealCoverage', () => {
    service.setMeal('2026-03-24', 'breakfast', { type: 'mock', title: SKIP_SENTINEL });
    fixture.detectChanges();
    // 7 days × 3 slots = 21 total; 1 skipped → 20 covered
    const expected = Math.round((20 / 21) * 100);
    expect(fixture.componentInstance.mealCoverage()).toBe(expected);
  });

  // ── New structure tests ───────────────────────────────────────────────────

  it('should render a completion banner container', () => {
    const banner = fixture.nativeElement.querySelector('.completion-banner');
    expect(banner).toBeTruthy();
  });

  it('should show "Ready to go!" heading inside the banner', () => {
    const heading = fixture.nativeElement.querySelector('.banner-heading');
    expect(heading?.textContent?.trim()).toBe('Ready to go!');
  });

  it('should render the step title', () => {
    const title = fixture.nativeElement.querySelector('.step-title');
    expect(title?.textContent?.trim()).toBe('Confirm Your Plan');
  });

  it('should render the week range in the subtitle', () => {
    const sub = fixture.nativeElement.querySelector('.step-sub');
    // initSession sets 2026-03-24 → 2026-03-30
    expect(sub?.textContent).toContain('Mar 24');
    expect(sub?.textContent).toContain('Mar 30');
  });

  it('should not show error banner when there is no error', () => {
    const el = fixture.nativeElement.querySelector('.error-banner');
    expect(el).toBeNull();
  });

  it('should show styled error banner when errorMessage is set', () => {
    fixture.componentInstance.errorMessage = 'Failed to save plan — please try again.';
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('.error-banner');
    expect(el).toBeTruthy();
    expect(el.textContent).toContain('Failed to save plan');
  });
});
```

- [ ] **Step 2: Run the tests to confirm new tests fail**

```bash
just test-ng-headless 2>&1 | grep -E "FAILED|PASSED|ERROR|confirm"
```

Expected: the 6 new tests (`completion-banner`, `banner-heading`, `step-title`, `week range`, `no error banner`, `styled error banner`) all FAIL; existing tests still PASS.

---

### Task 2: Implement the redesigned component

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.ts`

- [ ] **Step 3: Replace the entire file contents**

```typescript
import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { SKIP_SENTINEL, STANDARD_MEAL_SLOTS } from '../../../../core/models/week-plan';

@Component({
  selector: 'app-plan-confirm-step',
  standalone: true,
  imports: [],
  template: `
    <div class="plan-confirm">
      <div>
        <h2 class="step-title">Confirm Your Plan</h2>
        <p class="step-sub">
          Planning
          <span class="week-range">
            {{ formatWeekDate(weekPlanService.planStart()) }} → {{ formatWeekDate(weekPlanService.planEnd()) }}
          </span>
        </p>
      </div>

      <div class="completion-banner">
        <span class="banner-emoji">✅</span>
        <p class="banner-heading">Ready to go!</p>
        <div class="banner-stats">
          <div class="banner-stat">
            <span class="b-val">{{ totalDays() }}</span>
            <span class="b-lbl">Days</span>
          </div>
          <div class="banner-sep"></div>
          <div class="banner-stat">
            <span class="b-val">{{ mealCoverage() }}%</span>
            <span class="b-lbl">Meals</span>
          </div>
          <div class="banner-sep"></div>
          <div class="banner-stat">
            <span class="b-val">{{ taskCount() }}</span>
            <span class="b-lbl">Tasks</span>
          </div>
        </div>
      </div>

      @if (errorMessage) {
        <div class="error-banner" role="alert">{{ errorMessage }}</div>
      }

      <button class="btn-finish"
              type="button"
              [disabled]="weekPlanService.isSubmitting()"
              (click)="finish()">
        @if (weekPlanService.isSubmitting()) {
          Saving…
        } @else {
          Finish Week Plan
        }
      </button>
    </div>
  `,
  styles: [`
    .plan-confirm { display: flex; flex-direction: column; gap: 1rem; }

    /* ── Header ────────────────────────────────── */
    .step-title { font-size: 13px; font-weight: 800; color: var(--color-text-primary);
                  margin: 0 0 2px; }
    .step-sub { font-size: 11px; color: var(--color-text-muted); margin: 0;
                display: flex; align-items: center; gap: 5px; }
    .week-range { font-size: 10px; font-weight: 700;
                  background: var(--color-accent-light); border: 1px solid var(--color-accent-border);
                  border-radius: 4px; padding: 1px 6px; color: var(--color-accent-dark); }

    /* ── Completion banner ─────────────────────── */
    .completion-banner {
      background: var(--color-accent-light);
      border: 1.5px solid var(--color-accent-border);
      border-radius: 10px;
      padding: 16px;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      text-align: center;
    }
    .banner-emoji { font-size: 28px; line-height: 1; }
    .banner-heading { font-size: 13px; font-weight: 800; color: var(--color-accent-dark); margin: 0; }
    .banner-stats { display: flex; gap: 16px; align-items: center; }
    .banner-stat { display: flex; flex-direction: column; align-items: center; gap: 1px; }
    .b-val { font-size: 18px; font-weight: 800; line-height: 1; color: var(--color-accent-dark); }
    .b-lbl { font-size: 9px; color: var(--color-accent-dark); opacity: 0.7;
              font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .banner-sep { width: 1px; height: 28px; background: var(--color-accent-border); }

    /* ── Error banner ──────────────────────────── */
    .error-banner {
      background: var(--color-destructive-light);
      border: 1px solid var(--color-destructive-border);
      border-radius: 6px;
      padding: 7px 10px;
      font-size: 11px;
      color: var(--color-destructive);
    }

    /* ── CTA button ────────────────────────────── */
    .btn-finish {
      display: block; width: 100%;
      background: var(--color-accent); border: none;
      border-radius: 8px; padding: 12px;
      font-size: 14px; font-weight: 700; color: #fff;
      cursor: pointer;
    }
    .btn-finish:disabled { opacity: 0.4; cursor: not-allowed; }
  `]
})
export class PlanConfirmStepComponent {
  readonly weekPlanService = inject(WeekPlanService);
  private readonly router = inject(Router);

  errorMessage = '';

  readonly totalDays = computed(() => this.weekPlanService.horizonDays().length);
  readonly taskCount = computed(() => this.weekPlanService.scheduledTasks().length);

  readonly mealCoverage = computed(() => {
    const days = this.weekPlanService.horizonDays();
    if (days.length === 0) return 0;
    const meals = this.weekPlanService.scheduledMeals();
    const covered = days.reduce((acc, d) => {
      const daySlots = meals[d] ?? {};
      return acc + STANDARD_MEAL_SLOTS.filter(s => {
        const entry = daySlots[s];
        return !entry || entry.title !== SKIP_SENTINEL;
      }).length;
    }, 0);
    return Math.round((covered / (days.length * STANDARD_MEAL_SLOTS.length)) * 100);
  });

  formatWeekDate(isoDate: string): string {
    const dt = new Date(`${isoDate}T12:00:00`);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  finish(): void {
    this.errorMessage = '';
    this.weekPlanService.commitPlan(this.weekPlanService.planningTaskId()).subscribe({
      next: () => {
        this.router.navigate(['/day', this.weekPlanService.planStart()]);
      },
      error: () => {
        this.errorMessage = 'Failed to save plan — please try again.';
      },
    });
  }
}
```

- [ ] **Step 4: Run the full Angular test suite to verify all tests pass**

```bash
just test-ng-headless 2>&1 | grep -E "FAILED|SUCCESS|ERROR|confirm"
```

Expected: All tests PASS. Zero failures.

- [ ] **Step 5: Compile check**

```bash
just verify-build
```

Expected: Clean — no TypeScript errors.

---

### Task 3: Commit

- [ ] **Step 6: Stage and commit**

```bash
git add plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.ts \
        plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.spec.ts
git commit -m "$(cat <<'EOF'
fix(planning): redesign confirm step — stats banner and primary CTA (#63)

Replaces bare flex-row stats with a tinted completion banner, scales
stat values from 2rem down to 18px to match the wizard's type scale,
promotes the CTA to a full-width solid button, and styles the error
message as a proper bordered alert container.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
