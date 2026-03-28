import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { SKIP_SENTINEL, STANDARD_MEAL_SLOTS } from '../../../../core/models/week-plan';
import { formatWeekDate } from '../../utils/date-format.utils';

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
        <span class="banner-emoji" aria-hidden="true">✅</span>
        <p class="banner-heading">Ready to go!</p>
        <div class="banner-stats">
          <div class="banner-stat" role="group" [attr.aria-label]="totalDays() + ' days planned'">
            <span class="b-val" aria-hidden="true">{{ totalDays() }}</span>
            <span class="b-lbl" aria-hidden="true">Days</span>
          </div>
          <div class="banner-sep" aria-hidden="true"></div>
          <div class="banner-stat" role="group" [attr.aria-label]="mealCoverage() + '% meal coverage'">
            <span class="b-val" aria-hidden="true">{{ mealCoverage() }}%</span>
            <span class="b-lbl" aria-hidden="true">Meals</span>
          </div>
          <div class="banner-sep" aria-hidden="true"></div>
          <div class="banner-stat" role="group" [attr.aria-label]="taskCount() + ' tasks scheduled'">
            <span class="b-val" aria-hidden="true">{{ taskCount() }}</span>
            <span class="b-lbl" aria-hidden="true">Tasks</span>
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
        <span aria-live="polite">
          @if (weekPlanService.isSubmitting()) {
            Saving…
          } @else {
            Finish Week Plan
          }
        </span>
      </button>
    </div>
  `,
  styles: [`
    .plan-confirm { display: flex; flex-direction: column; gap: 1rem; }

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
      font-size: 14px; font-weight: 700; color: var(--color-surface-white);
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

  readonly formatWeekDate = formatWeekDate;

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
