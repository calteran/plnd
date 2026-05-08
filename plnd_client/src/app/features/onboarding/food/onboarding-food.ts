import { Component, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { WeekPlanService } from '../../../core/services/week-plan.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { localIsoDate } from '../../../core/services/schedule.service';
import { OnboardingStateService } from '../onboarding-state.service';
import { SpokeChromeComponent } from '../shared/spoke-chrome/spoke-chrome';
import { PlanningPrefsSubstepComponent } from '../shared/planning-prefs-substep/planning-prefs-substep';
import { DietaryRestrictionsSubstepComponent } from './substeps/dietary-restrictions-substep/dietary-restrictions-substep';
import { DietaryPreferencesSubstepComponent } from './substeps/dietary-preferences-substep/dietary-preferences-substep';
import { MealEntry, MealPlanResponse } from '../../../core/models/week-plan';
import { PlanMealsStepComponent } from '../../planning/steps/plan-meals-step/plan-meals-step';
import { mealsForDate } from '../../../core/utils/day-type-utils';

@Component({
  selector: 'app-onboarding-food',
  standalone: true,
  imports: [
    SpokeChromeComponent,
    PlanningPrefsSubstepComponent,
    DietaryRestrictionsSubstepComponent,
    DietaryPreferencesSubstepComponent,
    PlanMealsStepComponent,
  ],
  template: `
    <app-spoke-chrome
      title="Food & Meals"
      [totalSteps]="totalSteps()"
      [currentStep]="currentStep()"
      [continueDisabled]="continueDisabledForStep()"
      (backClick)="onBack()"
      (continueClick)="onContinue()"
    >
      @switch (internalStep()) {
        @case (0) {
          <app-planning-prefs-substep (complete)="advance()" />
        }
        @case (1) {
          <app-dietary-restrictions-substep (complete)="advance()" />
        }
        @case (2) {
          <app-dietary-preferences-substep (complete)="advance()" />
        }
        @case (3) {
          @if (planStart()) {
            <app-plan-meals-step
              [firstRun]="true"
              [planStart]="planStart()"
              [planEnd]="planEnd()"
            />
          } @else {
            <div class="meal-plan-loading">Preparing your meal plan…</div>
          }
        }
      }
    </app-spoke-chrome>
  `,
  styles: [`
    .meal-plan-loading { padding: 24px 16px; font-size: 13px; color: var(--color-text-muted, #6b7280); }
  `],
})
export class OnboardingFoodComponent implements OnInit {
  readonly internalStep = signal(0);

  private readonly weekPlanService = inject(WeekPlanService);
  private readonly state = inject(OnboardingStateService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly router = inject(Router);

  private readonly planningPrefsRef = viewChild(PlanningPrefsSubstepComponent);
  private readonly restrictionsRef = viewChild(DietaryRestrictionsSubstepComponent);
  private readonly preferencesRef = viewChild(DietaryPreferencesSubstepComponent);

  readonly totalSteps = computed(() => this.state.planningPrefsComplete() ? 3 : 4);
  readonly currentStep = computed(() => {
    const step = this.internalStep();
    return this.state.planningPrefsComplete() ? step : step + 1;
  });
  readonly planStart = computed(() => this.state.planPeriod()?.start ?? '');
  readonly planEnd = computed(() => this.state.planPeriod()?.end ?? '');
  readonly continueDisabledForStep = computed(() => {
    if (this.internalStep() === 0) return this.planningPrefsRef()?.isSaving() ?? false;
    return this.internalStep() === 3 && this.weekPlanService.isGenerating();
  });

  private sessionInitialized = false;

  constructor() {
    if (this.state.planningPrefsComplete()) {
      this.internalStep.set(1);
    }

    // Mirror the PlanningWizardComponent pattern: call initSession() once when
    // planPeriod becomes available and the user reaches the meal plan step.
    effect(() => {
      if (this.internalStep() !== 3) return;
      const period = this.state.planPeriod();
      if (!period || this.sessionInitialized) return;

      // Skip initSession if WeekPlanService is already at this period — the component
      // re-creates on navigation but WeekPlanService persists (root-scoped), so
      // re-calling initSession would clear generated meals.
      if (this.weekPlanService.planStart() === period.start &&
          this.weekPlanService.planEnd() === period.end) {
        this.sessionInitialized = true;
        return;
      }

      this.sessionInitialized = true;
      this.weekPlanService.initSession(period.start, period.end);
    });

    // Fallback for direct navigation to /onboarding/food (tasks section skipped):
    // planPeriod is not set, so we compute it reactively once preferences arrive.
    effect(() => {
      const prefs = this.preferencesService.preferences();
      if (!prefs || this.state.planPeriod()) return;
      this.state.computeAndSetPlanPeriod(localIsoDate(new Date()));
    });
  }

  ngOnInit(): void {
    // Ensure preferences are loaded; the reactive effect above fires when they arrive.
    if (!this.state.planPeriod()) {
      this.preferencesService.loadPreferences();
    }
  }

  advance(): void {
    this.internalStep.update(s => Math.min(s + 1, 3));
  }

  onBack(): void {
    const minStep = this.state.planningPrefsComplete() ? 1 : 0;
    if (this.internalStep() > minStep) {
      this.internalStep.update(s => s - 1);
    }
  }

  onContinue(): void {
    switch (this.internalStep()) {
      case 0: this.planningPrefsRef()?.save(); break;
      case 1: this.restrictionsRef()?.save(); break;
      case 2: this.preferencesRef()?.save(); break;
      case 3: this.finalSave(); break;
    }
  }

  private finalSave(): void {
    if (this.weekPlanService.isGenerating()) return;
    this.state.setMealPlan(this.buildMealPlanResponse());
    this.state.markComplete('food');
    this.router.navigate(['/onboarding']);
  }

  private buildMealPlanResponse(): MealPlanResponse {
    const planStart = this.weekPlanService.planStart() ?? '';
    const scheduled = this.weekPlanService.scheduledMeals();
    const dayTypes = this.state.dayTypes();
    const meals: MealEntry[] = [];
    for (const date of this.weekPlanService.horizonDays()) {
      const daySlots = scheduled[date] ?? {};
      const slotNames = mealsForDate(date, dayTypes).map(e => e.name);
      for (const slot of slotNames) {
        const planned = daySlots[slot];
        if (planned && planned.approvalState !== 'skipped' && planned.mealRef) {
          meals.push({
            date,
            meal_name: slot,
            meal_ref: planned.mealRef,
            title: planned.title || undefined,
            estimated: planned.estimated,
          });
        }
      }
    }
    return { plan_start: planStart, meals };
  }
}
