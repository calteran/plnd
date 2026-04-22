import { Component, OnInit, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { WeekPlanService } from '../../../core/services/week-plan.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { localIsoDate } from '../../../core/services/schedule.service';
import { OnboardingStateService } from '../onboarding-state.service';
import { PlanMealsStepComponent } from '../../planning/steps/plan-meals-step/plan-meals-step';

@Component({
  selector: 'app-onboarding-food',
  standalone: true,
  imports: [PlanMealsStepComponent],
  template: `
    <div class="onboarding-section">
      <h1>Food &amp; Meals</h1>

      <!-- Dietary restrictions sub-step — coming soon as part of #485 -->
      <div class="sub-step-stub">
        <strong>Dietary Restrictions</strong>
        <p>Add allergies, intolerances, and lifestyle choices here soon.</p>
      </div>

      <!-- Dietary preferences sub-step — coming soon as part of #485 -->
      <div class="sub-step-stub">
        <strong>Dietary Preferences</strong>
        <p>Rate ingredients you love or want to avoid here soon.</p>
      </div>

      <!-- Meal plan sub-step: mounted only after initSession() has run -->
      @if (weekPlanService.planStart()) {
        <app-plan-meals-step [firstRun]="true" />
      } @else {
        <div class="meal-plan-loading">Preparing your meal plan…</div>
      }

      <div class="section-footer">
        <button class="btn-save" type="button" (click)="saveAndContinue()">
          Save &amp; Continue
        </button>
      </div>
    </div>
  `,
  styles: [`
    .onboarding-section { padding: 24px; max-width: 900px; }
    h1 { margin: 0 0 20px; font-size: 22px; color: var(--color-text-primary); }
    .sub-step-stub {
      background: var(--color-surface-warm);
      border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;
      font-size: 13px; color: var(--color-text-muted);
    }
    .sub-step-stub strong {
      display: block; font-size: 12px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--color-text-secondary); margin-bottom: 4px;
    }
    .sub-step-stub p { margin: 0; }
    .meal-plan-loading {
      font-size: 13px; color: var(--color-text-muted);
      padding: 16px 0; margin-bottom: 16px;
    }
    .section-footer { display: flex; justify-content: flex-end; margin-top: 24px; }
    .btn-save {
      background: var(--color-accent-border); border: none; border-radius: 8px;
      padding: 10px 24px; font-size: 14px; font-weight: 600; color: #fff; cursor: pointer;
      transition: opacity 0.12s;
    }
    .btn-save:hover { opacity: 0.88; }
  `],
})
export class OnboardingFoodComponent implements OnInit {
  protected readonly weekPlanService   = inject(WeekPlanService);
  private readonly onboardingState     = inject(OnboardingStateService);
  private readonly preferencesService  = inject(PreferencesService);
  private readonly router              = inject(Router);

  private sessionInitialized = false;

  constructor() {
    // Mirror the PlanningWizardComponent pattern: call initSession() once when
    // planPeriod becomes available, keeping WeekPlanService's horizon in sync so
    // currentState() sends the right day range to the agent (fixes #507).
    effect(() => {
      const period = this.onboardingState.planPeriod();
      if (!period || this.sessionInitialized) return;
      this.sessionInitialized = true;
      this.weekPlanService.initSession(period.start, period.end);
    });

    // Fallback for direct navigation to /onboarding/food (tasks section skipped):
    // planPeriod is not set, so we compute it reactively once preferences arrive.
    effect(() => {
      const prefs = this.preferencesService.preferences();
      if (!prefs || this.onboardingState.planPeriod()) return;
      this.onboardingState.computeAndSetPlanPeriod(localIsoDate(new Date()));
    });
  }

  ngOnInit(): void {
    // Ensure preferences are loaded; the reactive effect above fires when they arrive.
    // localIsoDate uses local-noon parsing to avoid UTC-offset day rollback.
    if (!this.onboardingState.planPeriod()) {
      this.preferencesService.loadPreferences();
    }
  }

  saveAndContinue(): void {
    this.onboardingState.markComplete('food');
    this.router.navigate(['/onboarding']);
  }
}
