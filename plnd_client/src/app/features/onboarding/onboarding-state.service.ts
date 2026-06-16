// plnd_client/src/app/features/onboarding/onboarding-state.service.ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { PreferencesService } from '../../core/services/preferences.service';
import { MealPlanResponse, PlanEntryRequest } from '../../core/models/week-plan';
import { Routine } from '../../core/models/routine';
import { DayTypeResponse } from '../../core/models/day-type';
import { parseDateOnly, toDateOnly, daysBetweenDateOnly } from '../../core/utils/date-only';

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
  private readonly dayTypesSignal = signal<DayTypeResponse[]>([]);
  // Held in state so the hub stats banner can read totalRoutines without extra injection.
  // The Tasks component feeds this in after creating/fetching routines.
  private readonly routinesSignal = signal<Routine[]>([]);

  // ── Public read-only signals ────────────────────────────────────────────
  readonly sectionStatus = this.statusSignal.asReadonly();
  readonly mealPlan = this.mealPlanSignal.asReadonly();
  readonly planPeriod = this.planPeriodSignal.asReadonly();
  readonly enjoyedIngredients = this.enjoyedIngredientsSignal.asReadonly();
  readonly planningPrefsComplete = this.planningPrefsCompleteSignal.asReadonly();
  readonly upcomingTaskNames = this.upcomingTaskNamesSignal.asReadonly();
  readonly placedTasks = this.placedTasksSignal.asReadonly();
  readonly dayTypes = this.dayTypesSignal.asReadonly();
  readonly routines = this.routinesSignal.asReadonly();

  // ── Computed signals ────────────────────────────────────────────────────
  readonly allSectionsComplete = computed(() =>
    Object.values(this.statusSignal()).every(status => status === 'complete')
  );

  // Hub stats banner
  readonly totalRoutines = computed(() => this.routinesSignal().length);
  readonly totalTasks = computed(() => this.placedTasksSignal().length);
  // Server contract: MealPlanResponse.meals never includes skipped entries — MealEntry has
  // no skipped field and MEAL_PLAN_RESPONSE_SCHEMA in plnd_agent/src/context/mod.rs uses
  // additionalProperties:false, so any skipped field in an LLM response fails validation
  // (→ 422) before reaching here.
  // Caller contract: the food spoke's Meal Plan Review substep must filter out client-side
  // skipped slots before calling setMealPlan(). Pass only committed (non-skipped) entries.
  readonly totalMeals = computed(() => this.mealPlanSignal()?.meals.length ?? 0);
  readonly planDays = computed(() => {
    const p = this.planPeriodSignal();
    if (!p) return 0;
    // Inclusive whole-day span via the shared date-only helper (local-noon parsing
    // avoids UTC-offset day rollback).
    return daysBetweenDateOnly(p.end, p.start) + 1;
  });

  // ── Mutation methods ────────────────────────────────────────────────────
  markComplete(section: SectionId): void {
    this.statusSignal.update(s => ({ ...s, [section]: 'complete' }));
  }

  /** Store the committed meal plan for the hub stats banner.
   *  Caller must exclude client-side skipped slots before calling — pass only
   *  entries the user approved or left as proposed (not the raw API response). */
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

  // One-way flag: intentionally has no reset path. Mirrors markComplete(section) semantics.
  // Call only after successfully saving planning prefs to the backend.
  setPlanningPrefsComplete(): void {
    this.planningPrefsCompleteSignal.set(true);
  }

  setUpcomingTaskNames(names: string[]): void {
    this.upcomingTaskNamesSignal.set(names);
  }

  setPlacedTasks(tasks: PlanEntryRequest[]): void {
    this.placedTasksSignal.set(tasks);
  }

  setDayTypes(types: DayTypeResponse[]): void {
    this.dayTypesSignal.set(types);
  }

  setRoutines(routines: Routine[]): void {
    this.routinesSignal.set(routines);
  }
}

// Pure function — exported for unit testing without Angular DI.
/**
 * Compute the user's first planning window during onboarding.
 *
 * The window starts the day AFTER `today` — a new user is never asked to plan a
 * day that has already started — and runs to the end of the week containing that
 * start day, where a "week" is `default_plan_length_days` long and anchored on
 * `week_start_day`. When the next weekly-planning prompt is imminent (less than
 * 15% of a plan length away), the window extends through the following week so the
 * first plan is substantive rather than a one- or two-day stub.
 *
 * Invoked only during onboarding, which offers a 1- or 2-week plan length, so
 * `daysSinceWeekStart` (0–6) is always < planLength and the window is non-empty;
 * the function deliberately does not defend against planLength < 7.
 *
 * Uses local-noon Date parsing to avoid UTC-offset day rollback (same pattern as
 * WeekPlanService).
 */
export function computeFirstPlanPeriod(
  today: string,
  prefs: {
    default_plan_length_days: number;
    planning_trigger_offset: number;
    week_start_day: number;
  },
): { start: string; end: string } {
  const planLength = prefs.default_plan_length_days;
  const offset = prefs.planning_trigger_offset;
  const weekStartDay = prefs.week_start_day;

  // plan_start is tomorrow.
  const planStart = addDays(parseDateOnly(today), 1);

  // Anchor the window on the most recent week-start on or before plan_start.
  const daysSinceWeekStart = (planStart.getDay() - weekStartDay + 7) % 7;
  const currentPeriodStart = addDays(planStart, -daysSinceWeekStart);
  const nextPeriodStart = addDays(currentPeriodStart, planLength);
  const currentPeriodEnd = addDays(nextPeriodStart, -1); // inclusive end of plan_start's week

  // The next weekly-planning prompt fires `offset` days from the next period start.
  const firstTrigger = addDays(nextPeriodStart, offset);
  const daysUntilTrigger = Math.round(
    (firstTrigger.getTime() - planStart.getTime()) / 86_400_000,
  );

  // Most of the way through the current week → extend into the following week.
  // Both branches yield an end >= currentPeriodEnd, so no clamp is needed.
  const planEnd =
    daysUntilTrigger / planLength < 0.15
      ? addDays(nextPeriodStart, planLength - 1)
      : currentPeriodEnd;

  return { start: toDateOnly(planStart), end: toDateOnly(planEnd) };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}
