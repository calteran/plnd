import { Component, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { WeekPlanService } from '../../../core/services/week-plan.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { MealPatternService } from '../../../core/services/meal-pattern.service';
import { localIsoDate } from '../../../core/services/schedule.service';
import { OnboardingStateService } from '../onboarding-state.service';
import { SpokeChromeComponent } from '../shared/spoke-chrome/spoke-chrome';
import { PlanningPrefsSubstepComponent } from '../shared/planning-prefs-substep/planning-prefs-substep';
import { MealTimesSubstepComponent } from './substeps/meal-times-substep/meal-times-substep';
import { DietaryRestrictionsSubstepComponent } from './substeps/dietary-restrictions-substep/dietary-restrictions-substep';
import { DietaryPreferencesSubstepComponent } from './substeps/dietary-preferences-substep/dietary-preferences-substep';
import { MealEntry, MealPlanResponse } from '../../../core/models/week-plan';
import { PlanMealsStepComponent } from '../../planning/steps/plan-meals-step/plan-meals-step';

@Component({
  selector: 'app-onboarding-food',
  standalone: true,
  imports: [
    SpokeChromeComponent,
    PlanningPrefsSubstepComponent,
    MealTimesSubstepComponent,
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
          <app-meal-times-substep (complete)="advance()" />
        }
        @case (2) {
          <app-dietary-restrictions-substep (complete)="advance()" />
        }
        @case (3) {
          <app-dietary-preferences-substep (complete)="advance()" />
        }
        @case (4) {
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
  private readonly mealPatternService = inject(MealPatternService);
  private readonly router = inject(Router);

  private readonly planningPrefsRef = viewChild(PlanningPrefsSubstepComponent);
  private readonly mealTimesRef = viewChild(MealTimesSubstepComponent);
  private readonly restrictionsRef = viewChild(DietaryRestrictionsSubstepComponent);
  private readonly preferencesRef = viewChild(DietaryPreferencesSubstepComponent);

  readonly totalSteps = computed(() => this.state.planningPrefsComplete() ? 4 : 5);
  readonly currentStep = computed(() => {
    const step = this.internalStep();
    return this.state.planningPrefsComplete() ? step : step + 1;
  });
  readonly planStart = computed(() => this.state.planPeriod()?.start ?? '');
  readonly planEnd = computed(() => this.state.planPeriod()?.end ?? '');
  readonly continueDisabledForStep = computed(() => {
    if (this.internalStep() === 0) return this.planningPrefsRef()?.isSaving() ?? false;
    return this.internalStep() === 4 && this.weekPlanService.isGenerating();
  });

  private sessionInitialized = false;

  constructor() {
    if (this.state.planningPrefsComplete()) {
      this.internalStep.set(1);
    }

    // Mirror the PlanningWizardComponent pattern: call initSession() once when
    // planPeriod becomes available and the user reaches the meal plan step.
    effect(() => {
      if (this.internalStep() !== 4) return;
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
    this.mealPatternService.load();
    // Ensure preferences are loaded; the reactive effect above fires when they arrive.
    if (!this.state.planPeriod()) {
      this.preferencesService.loadPreferences();
    }
  }

  advance(): void {
    this.internalStep.update(s => Math.min(s + 1, 4));
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
      case 1: this.mealTimesRef()?.save(); break;
      case 2: this.restrictionsRef()?.save(); break;
      case 3: this.preferencesRef()?.save(); break;
      case 4: this.finalSave(); break;
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
    const slotNames = this.mealPatternService.entries().map(e => e.name);
    const meals: MealEntry[] = [];
    for (const date of this.weekPlanService.horizonDays()) {
      const daySlots = scheduled[date] ?? {};
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
