import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { WeekPlanService } from '../../../core/services/week-plan.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { MealPatternService } from '../../../core/services/meal-pattern.service';
import { localIsoDate } from '../../../core/services/schedule.service';
import { PlanReviewStepComponent } from '../steps/plan-review-step/plan-review-step';
import { PlanTasksStepComponent } from '../steps/plan-tasks-step/plan-tasks-step';
import { PlanMealsStepComponent } from '../steps/plan-meals-step/plan-meals-step';
import { PlanDayGridStepComponent } from '../steps/plan-day-grid-step/plan-day-grid-step';
import { PlanConfirmStepComponent } from '../steps/plan-confirm-step/plan-confirm-step';

interface WizardStep { n: number; label: string; disabled?: boolean; }

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
      </header>

      <div class="wizard-progress" role="progressbar"
           [attr.aria-valuenow]="enabledSteps().findIndex(s => s.n === weekPlanService.currentStep()) + 1"
           aria-valuemin="1" [attr.aria-valuemax]="enabledSteps().length">
        @for (s of steps(); track s.n) {
          @if (!$first) {
            <span class="progress-sep">›</span>
          }
          <div class="progress-pill"
               [class.active]="weekPlanService.currentStep() === s.n"
               [class.done]="weekPlanService.currentStep() > s.n && !s.disabled"
               [class.disabled]="s.disabled">
            <span class="pill-num">{{ s.n }}</span>
            <span class="pill-label">{{ s.label }}</span>
          </div>
        }
      </div>

      <div class="wizard-content">
        @if (weekPlanService.planStart()) {
          @switch (weekPlanService.currentStep()) {
            @case (1) {
              @if (carryoverLoading()) {
                <p>Loading…</p>
              } @else {
                <app-plan-review-step />
              }
            }
            @case (2) { <app-plan-tasks-step /> }
            @case (3) { <app-plan-meals-step /> }
            @case (5) { <app-plan-day-grid-step /> }
            @case (6) { <app-plan-confirm-step /> }
          }
        } @else {
          <p>Initializing session…</p>
        }
      </div>

      <footer class="wizard-footer">
        @if (hasPrevStep()) {
          <button class="nav-btn nav-btn--back" (click)="back()" type="button" aria-label="Previous step">‹</button>
        }
        @if (weekPlanService.currentStep() < 6) {
          <button class="nav-btn" (click)="next()" type="button" aria-label="Next step">›</button>
        }
      </footer>
    </div>
  `,
  styles: [`
    .planning-wizard { display: flex; flex-direction: column; height: 100%;
                       max-width: 860px; margin-inline: auto; width: 100%; }
    .wizard-header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; }
    .wizard-header h1 { font-size: 1.25rem; font-weight: 800; color: var(--color-text-primary);
                        letter-spacing: -0.02em; margin: 0; }
    .wizard-progress { display: flex; align-items: center; gap: 4px; padding: 0.5rem 1rem; }
    .progress-pill { display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px;
                     border-radius: 14px; border: 1.5px solid var(--color-border-row);
                     background: var(--color-surface-white); font-size: 11px; color: var(--color-text-muted); }
    .progress-pill.done { background: var(--color-surface-warm); border-color: var(--color-accent-border); color: var(--color-accent-dark); }
    .progress-pill.active { background: var(--color-accent-light); border-color: var(--color-accent); color: var(--color-accent-dark); }
    .progress-pill.active .pill-label { font-weight: 700; }
    .progress-pill.done .pill-num,
    .progress-pill.active .pill-num { background: var(--color-accent); color: #fff; }
    .progress-pill.disabled { opacity: 0.4; cursor: default; }
    .pill-num { width: 16px; height: 16px; border-radius: 50%; background: var(--color-border-row);
                display: flex; align-items: center; justify-content: center;
                font-size: 10px; font-weight: 700; flex-shrink: 0; }
    .pill-label { white-space: nowrap; }
    .progress-sep { color: var(--color-text-muted); font-size: 12px; user-select: none; }
    .wizard-content { flex: 1; overflow-y: auto; padding: 1rem; }
    .wizard-footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 1rem;
                     border-top: 1.5px solid var(--color-border-meal); }
    .nav-btn { background: var(--color-accent-light); border: 1.5px solid var(--color-accent-border);
               border-radius: 8px; padding: 5px 14px; color: var(--color-accent-dark);
               font-size: 16px; font-weight: 400; line-height: 1; min-width: 44px; min-height: 44px;
               display: flex; align-items: center; justify-content: center; }
    .nav-btn--back { margin-right: auto; }
  `]
})
export class PlanningWizardComponent implements OnInit {
  readonly weekPlanService = inject(WeekPlanService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly mealPatternService = inject(MealPatternService);

  protected readonly carryoverLoading = signal(true);

  readonly steps = computed<WizardStep[]>(() => [
    { n: 1, label: 'Carryover', disabled: !this.carryoverLoading() && this.weekPlanService.carryoverItems().length === 0 },
    { n: 2, label: 'Tasks' },
    { n: 3, label: 'Meals', disabled: this.mealPatternService.entries().length === 0 },
    { n: 4, label: 'Exercise', disabled: true },
    { n: 5, label: 'Review' },
    { n: 6, label: 'Confirm' },
  ]);

  readonly hasPrevStep = computed(() =>
    this.steps().some(s => s.n < this.weekPlanService.currentStep() && !s.disabled)
  );

  protected readonly enabledSteps = computed(() =>
    this.steps().filter(s => !s.disabled)
  );

  private sessionInitialized = false;

  constructor() {
    // If the current step becomes disabled (e.g. a saved draft at the meals step
    // when meal entries are now empty), skip forward to the next enabled step.
    effect(() => {
      const step = this.weekPlanService.currentStep();
      const stepEntry = this.steps().find(s => s.n === step);
      if (stepEntry?.disabled) this.next();
    });

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

      const planStartIso = localIsoDate(planStart);
      this.weekPlanService.initSession(planStartIso, localIsoDate(planEnd));
      this.weekPlanService.createOrFetchPlanTask(planStartIso).subscribe({
        error: err => console.error('Failed to create planning task', err),
      });
      this.weekPlanService.loadCarryover(planStartIso).subscribe({
        next: items => {
          this.carryoverLoading.set(false);
          if (items.length === 0 && this.weekPlanService.currentStep() === 1) {
            this.weekPlanService.goToStep(2);
          }
        },
        error: () => this.carryoverLoading.set(false),
      });
    });
  }

  ngOnInit(): void {
    this.preferencesService.loadPreferences();
    this.mealPatternService.load();
  }

  next(): void {
    const step = this.weekPlanService.currentStep();
    const nextStep = this.steps().find(s => s.n > step && !s.disabled);
    if (nextStep) this.weekPlanService.goToStep(nextStep.n);
  }

  back(): void {
    const step = this.weekPlanService.currentStep();
    const prevStep = this.steps().filter(s => s.n < step && !s.disabled).at(-1);
    if (prevStep) this.weekPlanService.goToStep(prevStep.n);
  }

}
