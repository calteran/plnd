import { Component, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { WeekPlanService } from '../../../core/services/week-plan.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { localIsoDate } from '../../../core/services/schedule.service';
import { OnboardingStateService } from '../onboarding-state.service';
import { SpokeChromeComponent } from '../shared/spoke-chrome/spoke-chrome';
import { PlanningPrefsSubstepComponent } from '../shared/planning-prefs-substep/planning-prefs-substep';
import { DayTypesSubstepComponent } from '../tasks/substeps/day-types-substep/day-types-substep';
import { DietaryRestrictionsSubstepComponent } from './substeps/dietary-restrictions-substep/dietary-restrictions-substep';
import { DietaryPreferencesSubstepComponent } from './substeps/dietary-preferences-substep/dietary-preferences-substep';
import { MealEntry, MealPlanResponse } from '../../../core/models/week-plan';
import { PlanMealsStepComponent } from '../../planning/steps/plan-meals-step/plan-meals-step';
import { mealsForDate } from '../../../core/utils/day-type-utils';

// Ordered union of every substep the food spoke can present. The active
// sequence is computed (see `substeps`) and conditionally drops the two
// shared substeps once they are satisfied:
//   - 'planning-prefs' is shared with the tasks spoke and skipped once the
//     user has saved planning preferences (`planningPrefsComplete`).
//   - 'day-types' is shared with the tasks spoke and skipped once the user
//     has configured at least one day type. It must run on first entry to
//     EITHER spoke, otherwise meal planning has no anchor slots to fill and
//     silently produces zero meals.
type FoodSubstep =
  | 'planning-prefs'
  | 'dietary-restrictions'
  | 'dietary-preferences'
  | 'day-types'
  | 'plan-meals';

@Component({
  selector: 'app-onboarding-food',
  standalone: true,
  imports: [
    SpokeChromeComponent,
    PlanningPrefsSubstepComponent,
    DietaryRestrictionsSubstepComponent,
    DietaryPreferencesSubstepComponent,
    DayTypesSubstepComponent,
    PlanMealsStepComponent,
  ],
  template: `
    <app-spoke-chrome
      title="Food & Meals"
      [totalSteps]="totalSteps()"
      [currentStep]="currentStep()"
      [showContinue]="showContinue()"
      [continueDisabled]="continueDisabled()"
      (backClick)="onBack()"
      (continueClick)="onContinue()"
    >
      @switch (activeSubstep()) {
        @case ('planning-prefs') {
          <app-planning-prefs-substep (complete)="onSubstepComplete()" />
        }
        @case ('dietary-restrictions') {
          <app-dietary-restrictions-substep (complete)="onSubstepComplete()" />
        }
        @case ('dietary-preferences') {
          <app-dietary-preferences-substep (complete)="onSubstepComplete()" />
        }
        @case ('day-types') {
          <app-day-types-substep (complete)="onSubstepComplete()" />
        }
        @case ('plan-meals') {
          @if (planStart()) {
            <app-plan-meals-step
              [firstRun]="true"
              [planStart]="planStart()"
              [planEnd]="planEnd()"
              [getMealsForDate]="getMealsForDateFn"
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
  private readonly weekPlanService = inject(WeekPlanService);
  private readonly state = inject(OnboardingStateService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly router = inject(Router);

  private readonly planningPrefsRef = viewChild(PlanningPrefsSubstepComponent);
  private readonly restrictionsRef = viewChild(DietaryRestrictionsSubstepComponent);
  private readonly preferencesRef = viewChild(DietaryPreferencesSubstepComponent);

  // The substep sequence is reactive: saving 'planning-prefs' or 'day-types'
  // flips the gating signal and drops that substep from the sequence. We track
  // the active substep by NAME (not index) so a mid-flow recompute never
  // mis-points the cursor.
  readonly substeps = computed<FoodSubstep[]>(() => {
    const seq: FoodSubstep[] = [];
    if (!this.state.planningPrefsComplete()) seq.push('planning-prefs');
    seq.push('dietary-restrictions', 'dietary-preferences');
    if (this.state.dayTypes().length === 0) seq.push('day-types');
    seq.push('plan-meals');
    return seq;
  });

  readonly activeSubstep = signal<FoodSubstep>(this.substeps()[0]);

  // The day-types substep carries its own "Save & Continue" button (it owns a
  // multi-card save transaction), so the chrome continue is hidden for it —
  // mirroring the tasks spoke.
  readonly showContinue = computed(() => this.activeSubstep() !== 'day-types');
  readonly totalSteps = computed(() => this.substeps().length);
  readonly currentStep = computed(() => {
    const idx = this.substeps().indexOf(this.activeSubstep());
    return idx < 0 ? 1 : idx + 1;
  });
  readonly continueDisabled = computed(() => {
    switch (this.activeSubstep()) {
      case 'planning-prefs': return this.planningPrefsRef()?.isSaving() ?? false;
      case 'plan-meals': return this.weekPlanService.isGenerating();
      default: return false;
    }
  });

  readonly planStart = computed(() => this.state.planPeriod()?.start ?? '');
  readonly planEnd   = computed(() => this.state.planPeriod()?.end ?? '');
  readonly getMealsForDateFn = (date: string) => mealsForDate(date, this.state.dayTypes());

  private sessionInitialized = false;

  constructor() {
    // Mirror the PlanningWizardComponent pattern: call initSession() once when
    // planPeriod becomes available and the user reaches the meal plan step.
    effect(() => {
      if (this.activeSubstep() !== 'plan-meals') return;
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

  /**
   * Advance to the next substep. Transitions are explicit by name rather than
   * index-based: saving 'planning-prefs'/'day-types' drops that substep from
   * the sequence before `complete` fires, so an index lookup on the recomputed
   * sequence would lose the cursor. The 'dietary-preferences' → 'day-types'
   * hop is skipped when day types are already configured.
   */
  onSubstepComplete(): void {
    switch (this.activeSubstep()) {
      case 'planning-prefs':
        this.activeSubstep.set('dietary-restrictions');
        break;
      case 'dietary-restrictions':
        this.activeSubstep.set('dietary-preferences');
        break;
      case 'dietary-preferences':
        this.activeSubstep.set(
          this.state.dayTypes().length === 0 ? 'day-types' : 'plan-meals',
        );
        break;
      case 'day-types':
        this.activeSubstep.set('plan-meals');
        break;
      case 'plan-meals':
        // Terminal substep; completion is handled by finalSave().
        break;
    }
  }

  onBack(): void {
    const seq = this.substeps();
    const idx = seq.indexOf(this.activeSubstep());
    if (idx > 0) {
      this.activeSubstep.set(seq[idx - 1]);
    } else {
      this.router.navigate(['/onboarding']);
    }
  }

  onContinue(): void {
    switch (this.activeSubstep()) {
      case 'planning-prefs': this.planningPrefsRef()?.save(); break;
      case 'dietary-restrictions': this.restrictionsRef()?.save(); break;
      case 'dietary-preferences': this.preferencesRef()?.save(); break;
      case 'plan-meals': this.finalSave(); break;
      // 'day-types' uses its own Save & Continue button (showContinue is false).
      case 'day-types': break;
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
