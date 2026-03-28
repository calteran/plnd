# Carryover Step Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `PlanReviewStepComponent` to match the visual quality of the rest of the planning wizard — better row padding, a cycling decision badge, a formatted date pill, and a polished empty state.

**Architecture:** All changes are confined to two files: `_tokens.scss` (new color tokens) and `plan-review-step.ts` (template + styles + a small cycling method). No new components, no service changes, no backend work.

**Tech Stack:** Angular 19 (standalone components, signals), SCSS tokens via CSS custom properties, Karma/Jasmine for unit tests.

---

## File Map

| File | Role |
|------|------|
| `plnd_client/src/styles/_tokens.scss` | Add 4 new tokens (success-light, success-border, destructive-light, destructive-border) in both `:root` and `[data-theme="dark"]` |
| `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.ts` | Full template + styles rewrite; add `formatDate()` and updated `decide()` cycling logic |
| `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.spec.ts` | Update existing tests broken by template changes; add tests for badge cycling and date formatting |

---

## Task 1: Add color tokens to `_tokens.scss`

**Files:**
- Modify: `plnd_client/src/styles/_tokens.scss`

The badge needs light-background and border tokens for the Accept (green) and Dismiss (red) states. Defer reuses the existing amber accent tokens. Tokens must be defined for both light and dark themes.

- [ ] **Step 1: Open `_tokens.scss` and add four tokens to `:root`**

  Insert after the `--color-success: #16a34a;` line:

  ```scss
  --color-success-light:        #dcfce7;
  --color-success-border:       #4ade80;
  ```

  Insert after the `--color-destructive: #dc2626;` line:

  ```scss
  --color-destructive-light:    #fee2e2;
  --color-destructive-border:   #f87171;
  ```

- [ ] **Step 2: Add dark-mode overrides to `[data-theme="dark"]`**

  Insert after `--color-success: #22c55e;` in the dark block:

  ```scss
  --color-success-light:        rgba(34, 197, 94, 0.15);
  --color-success-border:       #22c55e;
  ```

  Insert after `--color-destructive: #ef4444;` in the dark block:

  ```scss
  --color-destructive-light:    rgba(239, 68, 68, 0.15);
  --color-destructive-border:   #ef4444;
  ```

- [ ] **Step 3: Verify build compiles**

  ```bash
  just verify-build
  ```

  Expected: exits 0 with no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add plnd_client/src/styles/_tokens.scss
  git commit -m "feat(tokens): add success/destructive light and border tokens with dark-mode overrides (#62)"
  ```

---

## Task 2: Rewrite `PlanReviewStepComponent`

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.ts`

Replace the entire component. Key changes:
- `decide()` becomes a cycling method (no `action` parameter)
- New `displayDecision()` helper treats `undefined` as `'accept'`
- New `formatDate()` helper formats ISO date to `Mon, Mar 24`
- Template uses a single `.decision-badge` button per row
- Styles use only `--color-*` tokens — no raw hex values

- [ ] **Step 1: Replace the full component file**

  ```typescript
  import { Component, OnInit, inject } from '@angular/core';
  import { CommonModule } from '@angular/common';
  import { WeekPlanService } from '../../../../core/services/week-plan.service';
  import { CarryoverDecision } from '../../../../core/models/week-plan';

  const DECISION_CYCLE: CarryoverDecision[] = ['accept', 'defer', 'dismiss'];

  @Component({
    selector: 'app-plan-review-step',
    standalone: true,
    imports: [CommonModule],
    template: `
      <div class="plan-review">
        <h2 class="step-title">Review carry-over items</h2>
        <p class="step-sub">
          Planning
          <span class="week-range">
            {{ weekPlanService.planStart() }} → {{ weekPlanService.planEnd() }}
          </span>
        </p>

        @if (loading) {
          <p class="loading-text">Loading…</p>
        } @else if (weekPlanService.carryoverItems().length === 0) {
          <div class="empty-state">
            <span class="empty-emoji">🎉</span>
            <p class="empty-heading">All caught up!</p>
            <p class="empty-sub">No unfinished items from last week to review.</p>
          </div>
        } @else {
          <ul class="carryover-list">
            @for (item of weekPlanService.carryoverItems(); track item.entry_id) {
              <li class="carryover-item">
                <span class="item-title">{{ item.title ?? item.task_type }}</span>
                <span class="item-date">{{ formatDate(item.date) }}</span>
                <button type="button"
                        class="decision-badge"
                        [attr.data-decision]="displayDecision(item.entry_id)"
                        (click)="decide(item.entry_id)">
                  {{ displayDecision(item.entry_id) | titlecase }}
                  <span class="caret">▾</span>
                </button>
              </li>
            }
          </ul>
        }
      </div>
    `,
    styles: [`
      .plan-review { display: flex; flex-direction: column; gap: 1rem; }

      /* ── Header ──────────────────────────────────── */
      .step-title { font-size: 13px; font-weight: 800; color: var(--color-text-primary);
                    margin: 0 0 2px; }
      .step-sub { font-size: 11px; color: var(--color-text-muted); margin: 0;
                  display: flex; align-items: center; gap: 5px; }
      .week-range { font-size: 10px; font-weight: 700;
                    background: var(--color-accent-light); border: 1px solid var(--color-accent-border);
                    border-radius: 4px; padding: 1px 6px; color: var(--color-accent-dark); }

      /* ── List ────────────────────────────────────── */
      .carryover-list { list-style: none; margin: 0; padding: 0;
                        border: 1.5px solid var(--color-border-row); border-radius: 10px;
                        overflow: hidden; background: var(--color-surface-white); }
      .carryover-item { display: flex; align-items: center; gap: 9px;
                        padding: 11px 13px;
                        border-bottom: 1px solid var(--color-border-row); }
      .carryover-item:last-child { border-bottom: none; }
      .item-title { flex: 1; font-size: 13px; color: var(--color-text-body); }

      /* ── Date pill ───────────────────────────────── */
      .item-date { font-size: 10px; font-weight: 600; color: var(--color-text-muted);
                   background: var(--color-surface-white); border: 1px solid var(--color-border-row);
                   border-radius: 4px; padding: 2px 7px; white-space: nowrap; }

      /* ── Decision badge ──────────────────────────── */
      .decision-badge { display: inline-flex; align-items: center; gap: 5px;
                        border-radius: 20px; padding: 4px 10px;
                        font-size: 11px; font-weight: 700; border: 1.5px solid;
                        cursor: pointer; white-space: nowrap; min-width: 80px;
                        justify-content: space-between; background: none; }
      .caret { opacity: 0.5; font-size: 9px; }

      .decision-badge[data-decision="accept"] {
        background: var(--color-success-light);
        border-color: var(--color-success-border);
        color: var(--color-success);
      }
      .decision-badge[data-decision="defer"] {
        background: var(--color-accent-light);
        border-color: var(--color-accent-border);
        color: var(--color-accent-dark);
      }
      .decision-badge[data-decision="dismiss"] {
        background: var(--color-destructive-light);
        border-color: var(--color-destructive-border);
        color: var(--color-destructive);
      }

      /* ── Loading ─────────────────────────────────── */
      .loading-text { font-size: 12px; color: var(--color-text-muted); }

      /* ── Empty state ─────────────────────────────── */
      .empty-state { display: flex; flex-direction: column; align-items: center;
                     gap: 8px; padding: 32px 20px;
                     border: 1.5px solid var(--color-border-row); border-radius: 10px;
                     background: var(--color-surface-white); text-align: center; }
      .empty-emoji { font-size: 36px; line-height: 1; }
      .empty-heading { font-size: 13px; font-weight: 700;
                       color: var(--color-text-primary); margin: 0; }
      .empty-sub { font-size: 12px; color: var(--color-text-muted); margin: 0;
                   max-width: 220px; }
    `]
  })
  export class PlanReviewStepComponent implements OnInit {
    readonly weekPlanService = inject(WeekPlanService);
    loading = true;

    ngOnInit(): void {
      if (!this.weekPlanService.planStart()) {
        this.loading = false;
        return;
      }
      this.weekPlanService
        .loadPeriod(this.weekPlanService.planStart(), this.weekPlanService.planEnd())
        .subscribe({ next: () => (this.loading = false), error: () => (this.loading = false) });
    }

    displayDecision(entryId: string): CarryoverDecision {
      return this.weekPlanService.carryoverDecisions()[entryId] ?? 'accept';
    }

    decide(entryId: string): void {
      const current = this.displayDecision(entryId);
      const idx = DECISION_CYCLE.indexOf(current);
      const next = DECISION_CYCLE[(idx + 1) % DECISION_CYCLE.length];
      this.weekPlanService.setCarryoverDecision(entryId, next);
    }

    formatDate(isoDate: string): string {
      const dt = new Date(`${isoDate}T12:00:00`);
      return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
  }
  ```

  Note: The `decision()` helper from the old component has been removed — `displayDecision()` replaces it with the `?? 'accept'` default baked in. The `TitleCasePipe` is provided automatically by `CommonModule` which is already imported.

- [ ] **Step 2: Verify build compiles**

  ```bash
  just verify-build
  ```

  Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.ts
  git commit -m "feat(planning): redesign carryover review step — badge, date pill, empty state (#62)"
  ```

---

## Task 3: Update and extend the component tests

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.spec.ts`

The existing tests are broken by two template changes:
1. Empty state text changed from `"Nothing to carry over"` → `"All caught up!"`
2. `[data-action="defer"]` selector no longer exists — replaced by `.decision-badge`

Also add new tests for: badge default state, cycling behavior, and date formatting.

- [ ] **Step 1: Replace the full spec file**

  ```typescript
  import { ComponentFixture, TestBed } from '@angular/core/testing';
  import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
  import { PlanReviewStepComponent } from './plan-review-step';
  import { WeekPlanService } from '../../../../core/services/week-plan.service';

  const MOCK_ITEM = {
    entry_id: 'e1', title: 'Morning walk', task_type: 'custom',
    date: '2026-03-20', status: 'planned',
    scheduled_start: '2026-03-20T09:00:00Z'
  };

  describe('PlanReviewStepComponent', () => {
    let fixture: ComponentFixture<PlanReviewStepComponent>;
    let httpMock: HttpTestingController;
    let service: WeekPlanService;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [PlanReviewStepComponent, HttpClientTestingModule]
      }).compileComponents();
      service = TestBed.inject(WeekPlanService);
      service.initSession('2026-03-24', '2026-03-30');
      httpMock = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(PlanReviewStepComponent);
    });

    afterEach(() => httpMock.verify());

    function flush(carryover: typeof MOCK_ITEM[] = []) {
      fixture.detectChanges();
      httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({ entries: [], carryover });
      fixture.detectChanges();
    }

    it('should create', () => {
      flush();
      expect(fixture.componentInstance).toBeTruthy();
    });

    // ── Empty state ──────────────────────────────────────────────────────────

    it('shows "All caught up!" when there are no carryover items', () => {
      flush([]);
      expect(fixture.nativeElement.textContent).toContain('All caught up!');
    });

    it('does not show the carryover list when empty', () => {
      flush([]);
      expect(fixture.nativeElement.querySelector('.carryover-list')).toBeNull();
    });

    // ── Populated state ──────────────────────────────────────────────────────

    it('shows the item title', () => {
      flush([MOCK_ITEM]);
      expect(fixture.nativeElement.textContent).toContain('Morning walk');
    });

    it('does not show the empty state when items exist', () => {
      flush([MOCK_ITEM]);
      expect(fixture.nativeElement.querySelector('.empty-state')).toBeNull();
    });

    // ── Date formatting ──────────────────────────────────────────────────────

    it('formats the date as "Mon, Mar 24" style (not raw ISO)', () => {
      flush([MOCK_ITEM]);
      const dateEl = fixture.nativeElement.querySelector('.item-date') as HTMLElement;
      // 2026-03-20 is a Friday
      expect(dateEl.textContent?.trim()).toBe('Fri, Mar 20');
    });

    // ── Decision badge default ───────────────────────────────────────────────

    it('defaults to "Accept" decision before any tap', () => {
      flush([MOCK_ITEM]);
      const badge = fixture.nativeElement.querySelector('.decision-badge') as HTMLElement;
      expect(badge.getAttribute('data-decision')).toBe('accept');
      expect(badge.textContent).toContain('Accept');
    });

    // ── Cycling behavior ─────────────────────────────────────────────────────

    it('cycles Accept → Defer on first badge tap', () => {
      spyOn(service, 'setCarryoverDecision');
      flush([MOCK_ITEM]);
      const badge: HTMLButtonElement = fixture.nativeElement.querySelector('.decision-badge');
      badge.click();
      expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'defer');
    });

    it('cycles Defer → Dismiss on second badge tap', () => {
      flush([MOCK_ITEM]);
      // Set state to defer via the real impl BEFORE spying (spy replaces without calling through)
      service.setCarryoverDecision('e1', 'defer');
      fixture.detectChanges();
      spyOn(service, 'setCarryoverDecision');
      const badge: HTMLButtonElement = fixture.nativeElement.querySelector('.decision-badge');
      badge.click();
      expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'dismiss');
    });

    it('cycles Dismiss → Accept on third badge tap', () => {
      flush([MOCK_ITEM]);
      service.setCarryoverDecision('e1', 'dismiss');
      fixture.detectChanges();
      spyOn(service, 'setCarryoverDecision');
      const badge: HTMLButtonElement = fixture.nativeElement.querySelector('.decision-badge');
      badge.click();
      expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'accept');
    });
  });
  ```

- [ ] **Step 2: Run only the review step tests to confirm they pass**

  ```bash
  just test-ng-headless
  ```

  Expected: all tests in `PlanReviewStepComponent` pass. If any fail, check that `TitleCasePipe` is available via `CommonModule` (it is) and that `service.carryoverDecisions()` returns the updated value after calling `service.setCarryoverDecision()`.

- [ ] **Step 3: Run the full test suite**

  ```bash
  just test-ci
  ```

  Expected: exits 0 — all Rust (nextest) and Angular (headless) tests pass.

- [ ] **Step 4: Run the full quality suite**

  ```bash
  just verify
  ```

  Expected: exits 0 — fmt, clippy, deny, machete, ts-lint, ts-deps, build, and tests all pass.

- [ ] **Step 5: Commit**

  ```bash
  git add plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.spec.ts
  git commit -m "test(planning): update carryover step tests for redesign (#62)"
  ```

---

## Done

All three tasks committed on `feat/62-carryover-step-redesign`. Open a PR against `main` referencing calteran/plnd#62.
