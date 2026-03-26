import { Component, OnInit, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { WeekPlanService } from '../../../core/services/week-plan.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { toIsoDate } from '../../../core/services/schedule.service';
import { PlanReviewStepComponent } from '../steps/plan-review-step/plan-review-step';
import { PlanTasksStepComponent } from '../steps/plan-tasks-step/plan-tasks-step';
import { PlanMealsStepComponent } from '../steps/plan-meals-step/plan-meals-step';
import { PlanDayGridStepComponent } from '../steps/plan-day-grid-step/plan-day-grid-step';
import { PlanConfirmStepComponent } from '../steps/plan-confirm-step/plan-confirm-step';

@Component({
  selector: 'app-planning-wizard',
  standalone: true,
  imports: [
    PlanReviewStepComponent,
    PlanTasksStepComponent,
    PlanMealsStepComponent,
    PlanDayGridStepComponent,
    PlanConfirmStepComponent,
  ],
  template: `
    <div class="planning-wizard">
      <header class="wizard-header">
        <h1>Plan Your Week</h1>
        <button class="btn-cancel" (click)="cancel()" type="button">Cancel</button>
      </header>

      <div class="wizard-progress" role="progressbar"
           [attr.aria-valuenow]="weekPlanService.currentStep()"
           aria-valuemin="1" aria-valuemax="5">
        @for (s of steps; track s) {
          <div class="progress-step"
               [class.active]="weekPlanService.currentStep() === s"
               [class.done]="weekPlanService.currentStep() > s">
            {{ s }}
          </div>
        }
      </div>

      <div class="wizard-content">
        @if (weekPlanService.planStart()) {
          @switch (weekPlanService.currentStep()) {
            @case (1) { <app-plan-review-step /> }
            @case (2) { <app-plan-tasks-step /> }
            @case (3) { <app-plan-meals-step /> }
            @case (4) { <app-plan-day-grid-step /> }
            @case (5) { <app-plan-confirm-step /> }
          }
        } @else {
          <p>Initializing session…</p>
        }
      </div>

      <footer class="wizard-footer">
        @if (weekPlanService.currentStep() > 1) {
          <button class="nav-btn nav-btn--back" (click)="back()" type="button" aria-label="Previous step">‹</button>
        }
        @if (weekPlanService.currentStep() < 5) {
          <button class="nav-btn" (click)="next()" type="button" aria-label="Next step">›</button>
        }
      </footer>
    </div>
  `,
  styles: [`
    .planning-wizard { display: flex; flex-direction: column; height: 100%;
                       max-width: 860px; margin-inline: auto; width: 100%; }
    .wizard-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem; }
    .wizard-progress { display: flex; gap: 0.5rem; padding: 0.5rem 1rem; }
    .progress-step { width: 2rem; height: 2rem; border-radius: 50%; border: 2px solid var(--color-border-row);
                     display: flex; align-items: center; justify-content: center; }
    .progress-step.active { border-color: var(--color-accent); font-weight: bold; }
    .progress-step.done { background: var(--color-accent); color: #fff; border-color: transparent; }
    .wizard-content { flex: 1; overflow-y: auto; padding: 1rem; }
    .wizard-footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 1rem;
                     border-top: 1.5px solid var(--color-border-meal); }
    .nav-btn { background: var(--color-accent-light); border: 1.5px solid var(--color-accent-border);
               border-radius: 8px; padding: 5px 14px; color: var(--color-accent-dark);
               font-size: 18px; font-weight: 700; line-height: 1; min-width: 44px; min-height: 44px;
               display: flex; align-items: center; justify-content: center; }
    .nav-btn--back { margin-right: auto; }
  `]
})
export class PlanningWizardComponent implements OnInit {
  readonly weekPlanService = inject(WeekPlanService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly router = inject(Router);

  readonly steps = [1, 2, 3, 4, 5];

  private sessionInitialized = false;

  constructor() {
    // React when preferences load (may arrive after ngOnInit due to async HTTP).
    effect(() => {
      const prefs = this.preferencesService.preferences();
      if (!prefs || this.sessionInitialized) return;
      this.sessionInitialized = true;

      // Compute horizon start = next occurrence of configured week_start_day.
      // triggerOffset only controls when the "Plan your week" TASK appears
      // (handled by POST /tasks/weekly-plan) — it does NOT shift the horizon start.
      const today = new Date();
      const weekStartDay = prefs.week_start_day;
      const planLengthDays = prefs.default_plan_length_days;

      // Days until the next occurrence of weekStartDay (0 = today is the start day)
      const daysUntilStart = ((weekStartDay - today.getDay()) + 7) % 7;
      const planStart = new Date(today);
      planStart.setDate(today.getDate() + daysUntilStart);
      const planEnd = new Date(planStart);
      planEnd.setDate(planStart.getDate() + planLengthDays - 1);

      const planStartIso = toIsoDate(planStart);
      this.weekPlanService.initSession(planStartIso, toIsoDate(planEnd));
      this.weekPlanService.createOrFetchPlanTask(planStartIso).subscribe({
        error: err => console.error('Failed to create planning task', err),
      });
    });
  }

  ngOnInit(): void {
    this.preferencesService.loadPreferences();
  }

  next(): void {
    const step = this.weekPlanService.currentStep();
    if (step < 5) this.weekPlanService.goToStep(step + 1);
  }

  back(): void {
    const step = this.weekPlanService.currentStep();
    if (step > 1) this.weekPlanService.goToStep(step - 1);
  }

  cancel(): void {
    this.weekPlanService.clearDraft();
    this.router.navigate(['/today']);
  }
}
