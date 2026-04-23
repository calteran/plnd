// plnd_client/src/app/features/onboarding/onboarding-state.service.ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { PreferencesService } from '../../core/services/preferences.service';
import { MealPlanResponse, PlanEntryRequest } from '../../core/models/week-plan';
import { ScheduleTemplate } from '../../core/models/schedule-template';
import { ScheduleTypeResponse } from '../../core/models/schedule-type';
import { MealHabitResponse } from '../../core/models/meal-habit';

export type SectionId = 'account' | 'tasks' | 'food';
export type SectionStatus = 'not-started' | 'complete';

@Injectable()
export class OnboardingStateService {
  private readonly prefs = inject(PreferencesService);

  // ── Existing signals ────────────────────────────────────────────────────
  private readonly statusSignal = signal<Record<SectionId, SectionStatus>>({
    account: 'not-started',
    tasks: 'not-started',
    food: 'not-started',
  });
  private readonly mealPlanSignal = signal<MealPlanResponse | null>(null);
  private readonly planPeriodSignal = signal<{ start: string; end: string } | null>(null);
  private readonly enjoyedIngredientsSignal = signal<string[]>([]);

  // ── New signals (hub-and-spoke design) ─────────────────────────────────
  private readonly planningPrefsCompleteSignal = signal<boolean>(false);
  private readonly upcomingTaskNamesSignal = signal<string[]>([]);
  private readonly placedTasksSignal = signal<PlanEntryRequest[]>([]);
  private readonly scheduleTypesSignal = signal<ScheduleTypeResponse[]>([]);
  private readonly mealHabitsSignal = signal<MealHabitResponse[]>([]);
  // Held in state so the hub stats banner can read totalRoutines without extra injection.
  // The Tasks component feeds this in after creating/fetching templates.
  private readonly scheduleTemplatesSignal = signal<ScheduleTemplate[]>([]);

  // ── Public read-only signals ────────────────────────────────────────────
  readonly sectionStatus = this.statusSignal.asReadonly();
  readonly mealPlan = this.mealPlanSignal.asReadonly();
  readonly planPeriod = this.planPeriodSignal.asReadonly();
  readonly enjoyedIngredients = this.enjoyedIngredientsSignal.asReadonly();
  readonly planningPrefsComplete = this.planningPrefsCompleteSignal.asReadonly();
  readonly upcomingTaskNames = this.upcomingTaskNamesSignal.asReadonly();
  readonly placedTasks = this.placedTasksSignal.asReadonly();
  readonly scheduleTypes = this.scheduleTypesSignal.asReadonly();
  readonly mealHabits = this.mealHabitsSignal.asReadonly();
  readonly scheduleTemplates = this.scheduleTemplatesSignal.asReadonly();

  // ── Computed signals ────────────────────────────────────────────────────
  readonly allSectionsComplete = computed(() =>
    Object.values(this.statusSignal()).every(status => status === 'complete')
  );

  // Hub stats banner
  readonly totalRoutines = computed(() => this.scheduleTemplatesSignal().length);
  readonly totalTasks = computed(() => this.placedTasksSignal().length);
  readonly totalMeals = computed(() => this.mealPlanSignal()?.meals.length ?? 0);
  readonly planDays = computed(() => {
    const p = this.planPeriodSignal();
    if (!p) return 0;
    // Use local-noon parsing to avoid UTC-offset day rollback (same pattern as computeFirstPlanPeriod).
    const start = new Date(`${p.start}T12:00:00`);
    const end = new Date(`${p.end}T12:00:00`);
    return Math.round((end.getTime() - start.getTime()) / 86_400_000);
  });

  // ── Mutation methods ────────────────────────────────────────────────────
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

  setPlanningPrefsComplete(): void {
    this.planningPrefsCompleteSignal.set(true);
  }

  setUpcomingTaskNames(names: string[]): void {
    this.upcomingTaskNamesSignal.set(names);
  }

  setPlacedTasks(tasks: PlanEntryRequest[]): void {
    this.placedTasksSignal.set(tasks);
  }

  setScheduleTypes(types: ScheduleTypeResponse[]): void {
    this.scheduleTypesSignal.set(types);
  }

  setMealHabits(habits: MealHabitResponse[]): void {
    this.mealHabitsSignal.set(habits);
  }

  setScheduleTemplates(templates: ScheduleTemplate[]): void {
    this.scheduleTemplatesSignal.set(templates);
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

  // Guard: large negative offsets can push planEnd before firstPeriodEnd.
  if (planEnd.getTime() < firstPeriodEnd.getTime()) planEnd = firstPeriodEnd;

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
