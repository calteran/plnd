// plnd_client/src/app/features/onboarding/onboarding-state.service.ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { PreferencesService } from '../../core/services/preferences.service';
import { MealPlanResponse } from '../../core/models/week-plan';

export type SectionId = 'account' | 'tasks' | 'food';
export type SectionStatus = 'not-started' | 'complete';

@Injectable()
export class OnboardingStateService {
  private readonly prefs = inject(PreferencesService);

  private readonly statusSignal = signal<Record<SectionId, SectionStatus>>({
    account: 'not-started',
    tasks: 'not-started',
    food: 'not-started',
  });
  private readonly mealPlanSignal = signal<MealPlanResponse | null>(null);
  private readonly planPeriodSignal = signal<{ start: string; end: string } | null>(null);
  private readonly enjoyedIngredientsSignal = signal<string[]>([]);

  readonly sectionStatus = this.statusSignal.asReadonly();
  readonly mealPlan = this.mealPlanSignal.asReadonly();
  readonly planPeriod = this.planPeriodSignal.asReadonly();
  readonly enjoyedIngredients = this.enjoyedIngredientsSignal.asReadonly();

  readonly allSectionsComplete = computed(() => {
    const s = this.statusSignal();
    return s.account === 'complete' && s.tasks === 'complete' && s.food === 'complete';
  });

  markComplete(section: SectionId): void {
    this.statusSignal.update(s => ({ ...s, [section]: 'complete' }));
  }

  setMealPlan(plan: MealPlanResponse | null): void {
    this.mealPlanSignal.set(plan);
  }

  setEnjoyedIngredients(ingredients: string[]): void {
    this.enjoyedIngredientsSignal.set(ingredients);
  }

  computeAndSetPlanPeriod(today: string): void {
    const userPrefs = this.prefs.preferences();
    if (!userPrefs) return;
    this.planPeriodSignal.set(computeFirstPlanPeriod(today, userPrefs));
  }
}

// Pure function — exported for unit testing without Angular DI.
// Uses local-noon Date parsing to avoid UTC-offset day rollback (same pattern as WeekPlanService).
export function computeFirstPlanPeriod(
  today: string,
  prefs: { default_plan_length_days: number; planning_trigger_offset: number }
): { start: string; end: string } {
  const planLength = prefs.default_plan_length_days;
  const offset = prefs.planning_trigger_offset;
  const startDate = new Date(`${today}T12:00:00`);

  const firstPeriodEnd = addDays(startDate, planLength);
  const firstTrigger = addDays(firstPeriodEnd, offset);
  const daysUntilTrigger = Math.round(
    (firstTrigger.getTime() - startDate.getTime()) / 86_400_000
  );

  let planEnd: Date;
  if (daysUntilTrigger / planLength < 0.15) {
    const secondPeriodEnd = addDays(firstPeriodEnd, planLength);
    planEnd = addDays(secondPeriodEnd, offset);
  } else {
    planEnd = firstPeriodEnd;
  }

  return { start: today, end: toISODate(planEnd) };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
