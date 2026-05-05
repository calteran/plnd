// plnd_client/src/app/features/onboarding/onboarding-state.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { OnboardingStateService, computeFirstPlanPeriod, SectionId } from './onboarding-state.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { UserPreferences } from '../../core/models/preferences';
import { MealEntry, PlanEntryRequest } from '../../core/models/week-plan';
import { ScheduleTemplate } from '../../core/models/schedule-template';
import { DayTypeResponse } from '../../core/models/schedule-type';
import { MealHabitResponse } from '../../core/models/meal-habit';

describe('OnboardingStateService', () => {
  let service: OnboardingStateService;
  let prefsSignal: WritableSignal<UserPreferences | null>;

  beforeEach(() => {
    prefsSignal = signal<UserPreferences | null>(null);
    TestBed.configureTestingModule({
      providers: [
        OnboardingStateService,
        { provide: PreferencesService, useValue: { preferences: prefsSignal.asReadonly() } }
      ]
    });
    service = TestBed.inject(OnboardingStateService);
  });

  it('initial state: all sections not-started, mealPlan and planPeriod null', () => {
    expect(service.sectionStatus()).toEqual({ account: 'not-started', tasks: 'not-started', food: 'not-started' });
    expect(service.mealPlan()).toBeNull();
    expect(service.planPeriod()).toBeNull();
    expect(service.enjoyedIngredients()).toEqual([]);
  });

  it('markComplete transitions the given section to complete, others unchanged', () => {
    service.markComplete('account');
    expect(service.sectionStatus().account).toBe('complete');
    expect(service.sectionStatus().tasks).toBe('not-started');
    expect(service.sectionStatus().food).toBe('not-started');
  });

  it('allSectionsComplete is false while any section is not-started', () => {
    service.markComplete('account');
    service.markComplete('tasks');
    expect(service.allSectionsComplete()).toBeFalse();
  });

  it('allSectionsComplete is true when all three sections are marked complete', () => {
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => service.markComplete(s));
    expect(service.allSectionsComplete()).toBeTrue();
  });

  it('setMealPlan stores and exposes the meal plan', () => {
    const fakePlan = { meals: [] } as unknown as ReturnType<typeof service.mealPlan>;
    service.setMealPlan(fakePlan);
    expect(service.mealPlan()).toBe(fakePlan);
  });

  it('setEnjoyedIngredients stores ingredients', () => {
    service.setEnjoyedIngredients(['broccoli', 'tofu']);
    expect(service.enjoyedIngredients()).toEqual(['broccoli', 'tofu']);
  });

  it('computeAndSetPlanPeriod is a no-op when preferences are not yet loaded', () => {
    // prefsSignal is null (default) — method should return early without throwing
    service.computeAndSetPlanPeriod('2026-04-22');
    expect(service.planPeriod()).toBeNull();
  });

  it('computeAndSetPlanPeriod sets planPeriod when preferences are loaded', () => {
    prefsSignal.set({
      user_id: 'u1',
      week_start_day: 1,
      planning_trigger_offset: -3,
      default_plan_length_days: 7,
      wake_time: '07:00:00',
      email_notifications_enabled: false,
      sms_notifications_enabled: false,
      push_notifications_enabled: false,
      phone_number: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-22');
    const period = service.planPeriod();
    expect(period).not.toBeNull();
    expect(period!.start).toBe('2026-04-22');
    expect(period!.end).toBe('2026-04-29'); // offset=-3 → ratio 4/7 = 0.57 ≥ 0.15 → normal case
  });

  // ── New signal initial state ────────────────────────────────────────────

  it('initial state: planningPrefsComplete false, arrays empty', () => {
    expect(service.planningPrefsComplete()).toBeFalse();
    expect(service.upcomingTaskNames()).toEqual([]);
    expect(service.placedTasks()).toEqual([]);
    expect(service.dayTypes()).toEqual([]);
    expect(service.mealHabits()).toEqual([]);
    expect(service.scheduleTemplates()).toEqual([]);
  });

  // ── Setter methods ──────────────────────────────────────────────────────

  it('setPlanningPrefsComplete sets the flag to true', () => {
    service.setPlanningPrefsComplete();
    expect(service.planningPrefsComplete()).toBeTrue();
  });

  it('setPlanningPrefsComplete is idempotent — calling twice stays true', () => {
    service.setPlanningPrefsComplete();
    service.setPlanningPrefsComplete();
    expect(service.planningPrefsComplete()).toBeTrue();
  });

  it('setUpcomingTaskNames stores the names', () => {
    service.setUpcomingTaskNames(['Morning run', 'Read 20 min']);
    expect(service.upcomingTaskNames()).toEqual(['Morning run', 'Read 20 min']);
  });

  it('setPlacedTasks stores the placed task entries', () => {
    const tasks: PlanEntryRequest[] = [
      { date: '2026-04-22', task_type: 'general', title: 'Morning run', scheduled_start: '07:00' },
    ];
    service.setPlacedTasks(tasks);
    expect(service.placedTasks()).toEqual(tasks);
  });

  it('setDayTypes stores day type records', () => {
    const types: DayTypeResponse[] = [
      {
        id: 'st-1', user_id: 'u1', name: 'Weekdays',
        days_bitmask: 0b0111110, wake_time: '07:00:00', sleep_time: '22:00:00',
        is_default: false, is_cycle: false, cycle_length: null, anchor_date: null,
        created_at: '2026-04-22T00:00:00Z',
      },
    ];
    service.setDayTypes(types);
    expect(service.dayTypes()).toEqual(types);
  });

  it('setMealHabits stores meal habit records', () => {
    const habits: MealHabitResponse[] = [
      {
        id: 'mh-1', user_id: 'u1', meal_name: 'Oatmeal',
        slot: 'breakfast', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        created_at: '2026-04-22T00:00:00Z',
      },
    ];
    service.setMealHabits(habits);
    expect(service.mealHabits()).toEqual(habits);
  });

  it('setScheduleTemplates stores template records', () => {
    const templates: ScheduleTemplate[] = [
      {
        template_id: 'tmpl-1', user_id: 'u1', task_type: 'general',
        title: 'Morning run', recurrence: 'weekdays',
        recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        time_window_start: '07:00', time_window_end: '08:00',
        duration_minutes: 30, energy_required: 'medium',
        is_anchor: false, task_ref_id: null, task_ref_type: null,
        created_at: '2026-04-22T00:00:00Z', updated_at: '2026-04-22T00:00:00Z',
      },
    ];
    service.setScheduleTemplates(templates);
    expect(service.scheduleTemplates()).toEqual(templates);
  });

  // ── Computed signals ────────────────────────────────────────────────────

  it('totalRoutines reflects scheduleTemplates length', () => {
    expect(service.totalRoutines()).toBe(0);
    service.setScheduleTemplates([
      {
        template_id: 'a', user_id: 'u1', task_type: 'general', title: 'A',
        recurrence: 'daily', recurrence_rule: 'FREQ=DAILY',
        time_window_start: null, time_window_end: null, duration_minutes: null,
        energy_required: 'low', is_anchor: false, task_ref_id: null, task_ref_type: null,
        created_at: '2026-04-22T00:00:00Z', updated_at: '2026-04-22T00:00:00Z',
      },
      {
        template_id: 'b', user_id: 'u1', task_type: 'general', title: 'B',
        recurrence: 'daily', recurrence_rule: 'FREQ=DAILY',
        time_window_start: null, time_window_end: null, duration_minutes: null,
        energy_required: 'low', is_anchor: false, task_ref_id: null, task_ref_type: null,
        created_at: '2026-04-22T00:00:00Z', updated_at: '2026-04-22T00:00:00Z',
      },
    ]);
    expect(service.totalRoutines()).toBe(2);
  });

  it('totalTasks reflects placedTasks length', () => {
    expect(service.totalTasks()).toBe(0);
    service.setPlacedTasks([
      { date: '2026-04-22', task_type: 'general', title: 'Task A', scheduled_start: '09:00' },
      { date: '2026-04-23', task_type: 'general', title: 'Task B', scheduled_start: '10:00' },
    ]);
    expect(service.totalTasks()).toBe(2);
  });

  it('totalMeals is 0 when no meal plan is set', () => {
    expect(service.totalMeals()).toBe(0);
  });

  it('totalMeals counts all entries in the stored meal plan', () => {
    // title is a client-side field not in the agent JSON schema (MealEntry has no skipped field
    // either; MEAL_PLAN_RESPONSE_SCHEMA uses additionalProperties:false for server responses).
    const fakeMeals: MealEntry[] = [
      { date: '2026-04-22', occasion: 'breakfast', meal_ref: null, title: '' },
      { date: '2026-04-22', occasion: 'lunch',     meal_ref: null, title: '' },
      { date: '2026-04-22', occasion: 'dinner',    meal_ref: null, title: '' },
      { date: '2026-04-23', occasion: 'breakfast', meal_ref: null, title: '' },
    ];
    service.setMealPlan({ plan_start: '2026-04-22', meals: fakeMeals });
    expect(service.totalMeals()).toBe(4);
  });

  it('totalMeals reflects caller-filtered list — food spoke must exclude skipped slots before setMealPlan', () => {
    // MealEntry has no skipped field; the server schema enforces this via additionalProperties:false.
    // The food spoke's Meal Plan Review substep is responsible for filtering out client-side
    // skipped slots. This test documents that totalMeals counts whatever was passed to setMealPlan.
    const committed: MealEntry[] = [
      { date: '2026-04-22', occasion: 'breakfast', meal_ref: null, title: '' },
      { date: '2026-04-22', occasion: 'lunch',     meal_ref: null, title: '' },
      // dinner was skipped by the user — food spoke excludes it before calling setMealPlan
    ];
    service.setMealPlan({ plan_start: '2026-04-22', meals: committed });
    expect(service.totalMeals()).toBe(2); // not 3 (the server proposed 3, user skipped dinner)
  });

  it('planDays is 0 when no plan period is set', () => {
    expect(service.planDays()).toBe(0);
  });

  it('planDays computes days between start and end', () => {
    prefsSignal.set({
      user_id: 'u1', week_start_day: 1,
      planning_trigger_offset: -3, default_plan_length_days: 7,
      wake_time: '07:00:00',
      email_notifications_enabled: false, sms_notifications_enabled: false,
      push_notifications_enabled: false, phone_number: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-22');
    // start='2026-04-22', end='2026-04-29' → 7 days
    expect(service.planDays()).toBe(7);
  });

  it('planDays works for 14-day plan periods', () => {
    prefsSignal.set({
      user_id: 'u1', week_start_day: 1,
      planning_trigger_offset: -2, default_plan_length_days: 14,
      wake_time: '07:00:00',
      email_notifications_enabled: false, sms_notifications_enabled: false,
      push_notifications_enabled: false, phone_number: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-22');
    // start='2026-04-22', end='2026-05-06' → 14 days
    expect(service.planDays()).toBe(14);
  });

  it('planDays works for 28-day plan periods', () => {
    prefsSignal.set({
      user_id: 'u1', week_start_day: 1,
      planning_trigger_offset: -2, default_plan_length_days: 28,
      wake_time: '07:00:00',
      email_notifications_enabled: false, sms_notifications_enabled: false,
      push_notifications_enabled: false, phone_number: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-22');
    // offset=-2, planLength=28 → trigger on day 26 → ratio 26/28 = 0.929 ≥ 0.15 → normal
    // end = 2026-04-22 + 28 = 2026-05-20
    expect(service.planDays()).toBe(28);
  });
});

describe('computeFirstPlanPeriod', () => {
  it('normal case: plan_end = today + default_plan_length_days when ratio >= 0.15', () => {
    // offset=-3, planLength=7 → trigger on day 4 → ratio 4/7 = 0.57 ≥ 0.15
    const result = computeFirstPlanPeriod('2026-04-22', { default_plan_length_days: 7, planning_trigger_offset: -3 });
    expect(result.start).toBe('2026-04-22');
    expect(result.end).toBe('2026-04-29');
  });

  it('extends to second trigger when ratio < 0.15 (offset=-6, planLength=7)', () => {
    // trigger on day 1 → ratio 1/7 = 0.143 < 0.15 → extend
    // secondPeriodEnd = today+14, secondTrigger = today+14-6 = today+8 = 2026-04-30
    const result = computeFirstPlanPeriod('2026-04-22', { default_plan_length_days: 7, planning_trigger_offset: -6 });
    expect(result.start).toBe('2026-04-22');
    expect(result.end).toBe('2026-04-30');
  });

  it('extends when trigger fires on day 0 (offset=-7, planLength=7)', () => {
    // trigger on day 0 → ratio 0/7 = 0 < 0.15 → extend
    // secondPeriodEnd = today+14, secondTrigger = today+14-7 = today+7 = 2026-04-29
    const result = computeFirstPlanPeriod('2026-04-22', { default_plan_length_days: 7, planning_trigger_offset: -7 });
    expect(result.start).toBe('2026-04-22');
    expect(result.end).toBe('2026-04-29');
  });

  it('does NOT extend when ratio is above 0.15 (offset=-5, planLength=7, ratio=2/7=0.286)', () => {
    // trigger on day 2 → ratio 2/7 = 0.286 ≥ 0.15 → normal
    const result = computeFirstPlanPeriod('2026-04-22', { default_plan_length_days: 7, planning_trigger_offset: -5 });
    expect(result.start).toBe('2026-04-22');
    expect(result.end).toBe('2026-04-29');
  });

  it('works with 14-day plan lengths', () => {
    // offset=-2, planLength=14 → trigger on day 12 → ratio 12/14 = 0.857 ≥ 0.15 → normal
    const result = computeFirstPlanPeriod('2026-04-22', { default_plan_length_days: 14, planning_trigger_offset: -2 });
    expect(result.start).toBe('2026-04-22');
    expect(result.end).toBe('2026-05-06');
  });

  it('clamps planEnd to firstPeriodEnd when |offset| > planLength (offset=-10, planLength=7)', () => {
    // trigger fires on day -3 → ratio -3/7 < 0.15 → extension branch
    // secondPeriodEnd = today+14, secondTrigger = today+4 which is before firstPeriodEnd (today+7)
    // clamp applies → planEnd = today+7 = 2026-04-29
    const result = computeFirstPlanPeriod('2026-04-22', { default_plan_length_days: 7, planning_trigger_offset: -10 });
    expect(result.start).toBe('2026-04-22');
    expect(result.end).toBe('2026-04-29');
  });

  it('works with 28-day plan lengths (4-week segmented option)', () => {
    // offset=-2, planLength=28 → trigger on day 26 → ratio 26/28 = 0.929 ≥ 0.15 → normal
    const result = computeFirstPlanPeriod('2026-04-22', { default_plan_length_days: 28, planning_trigger_offset: -2 });
    expect(result.start).toBe('2026-04-22');
    expect(result.end).toBe('2026-05-20');
  });
});
