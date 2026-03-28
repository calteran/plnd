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
      <h2>Confirm Your Plan</h2>

      <div class="summary-stats">
        <div class="stat">
          <span class="stat-value">{{ totalDays() }}</span>
          <span class="stat-label">Days planned</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ mealCoverage() }}%</span>
          <span class="stat-label">Meal coverage</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ taskCount() }}</span>
          <span class="stat-label">Tasks</span>
        </div>
      </div>

      @if (errorMessage) {
        <p class="error-message" role="alert">{{ errorMessage }}</p>
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
    .plan-confirm { display: flex; flex-direction: column; gap: 1.5rem; }
    .summary-stats { display: flex; gap: 2rem; }
    .stat { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .stat-value { font-size: 2rem; font-weight: 700; color: var(--color-accent); line-height: 1; }
    .stat-label { font-size: 12px; color: var(--color-text-muted); }
    .error-message { color: var(--color-destructive); font-size: 13px; }
    .btn-finish { background: var(--color-accent-light); border: 1.5px solid var(--color-accent-border);
                  border-radius: 6px; padding: 8px 20px; font-size: 13px; font-weight: 600;
                  color: var(--color-accent-dark); cursor: pointer; align-self: flex-end; }
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
    // Pending slots (no entry) = implicitly accepted = covered.
    // Only the SKIP_SENTINEL reduces coverage.
    const covered = days.reduce((acc, d) => {
      const daySlots = meals[d] ?? {};
      return acc + STANDARD_MEAL_SLOTS.filter(s => {
        const entry = daySlots[s];
        return !entry || entry.title !== SKIP_SENTINEL;
      }).length;
    }, 0);
    return Math.round((covered / (days.length * STANDARD_MEAL_SLOTS.length)) * 100);
  });

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
