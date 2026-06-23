// plnd_client/src/app/features/onboarding/onboarding-state.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { OnboardingStateService, computeFirstPlanPeriod, SectionId } from './onboarding-state.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { UserPreferences } from '../../core/models/preferences';
import { MealEntry, PlanEntryRequest } from '../../core/models/week-plan';
import { Routine } from '../../core/models/routine';
import { DayTypeResponse } from '../../core/models/day-type';

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
    expect(service.allSectionsComplete()).toBe(false);
  });

  it('allSectionsComplete is true when all three sections are marked complete', () => {
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => service.markComplete(s));
    expect(service.allSectionsComplete()).toBe(true);
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
      planning_trigger_offset: -1,
      default_plan_length_days: 7,
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
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; current week ends Sun 2026-04-26.
    expect(period!.start).toBe('2026-04-23');
    expect(period!.end).toBe('2026-04-26');
  });

  // ── New signal initial state ────────────────────────────────────────────

  it('initial state: planningPrefsComplete false, arrays empty', () => {
    expect(service.planningPrefsComplete()).toBe(false);
    expect(service.upcomingTaskNames()).toEqual([]);
    expect(service.placedTasks()).toEqual([]);
    expect(service.dayTypes()).toEqual([]);
    expect(service.routines()).toEqual([]);
  });

  // ── Setter methods ──────────────────────────────────────────────────────

  it('setPlanningPrefsComplete sets the flag to true', () => {
    service.setPlanningPrefsComplete();
    expect(service.planningPrefsComplete()).toBe(true);
  });

  it('setPlanningPrefsComplete is idempotent — calling twice stays true', () => {
    service.setPlanningPrefsComplete();
    service.setPlanningPrefsComplete();
    expect(service.planningPrefsComplete()).toBe(true);
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
        is_cycle: false, cycle_length: null, anchor_date: null, cycle_bitmask: 0,
        created_at: '2026-04-22T00:00:00Z',
      },
    ];
    service.setDayTypes(types);
    expect(service.dayTypes()).toEqual(types);
  });

  it('setRoutines stores routine records', () => {
    const routines: Routine[] = [
      {
        routine_id: 'tmpl-1', user_id: 'u1', task_type: 'general',
        title: 'Morning run', recurrence_tag: 'weekdays',
        recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        time_window_start: '07:00', time_window_end: '08:00',
        duration_minutes: 30, energy_required: 'medium',
        is_anchor: false,
        created_at: '2026-04-22T00:00:00Z', updated_at: '2026-04-22T00:00:00Z',
      },
    ];
    service.setRoutines(routines);
    expect(service.routines()).toEqual(routines);
  });

  // ── Computed signals ────────────────────────────────────────────────────

  it('totalRoutines reflects routines length', () => {
    expect(service.totalRoutines()).toBe(0);
    service.setRoutines([
      {
        routine_id: 'a', user_id: 'u1', task_type: 'general', title: 'A',
        recurrence_tag: 'daily', recurrence_rule: 'FREQ=DAILY',
        time_window_start: null, time_window_end: null, duration_minutes: null,
        energy_required: 'low', is_anchor: false,
        created_at: '2026-04-22T00:00:00Z', updated_at: '2026-04-22T00:00:00Z',
      },
      {
        routine_id: 'b', user_id: 'u1', task_type: 'general', title: 'B',
        recurrence_tag: 'daily', recurrence_rule: 'FREQ=DAILY',
        time_window_start: null, time_window_end: null, duration_minutes: null,
        energy_required: 'low', is_anchor: false,
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
      { date: '2026-04-22', meal_name: 'breakfast', meal_ref: null, title: '' },
      { date: '2026-04-22', meal_name: 'lunch',     meal_ref: null, title: '' },
      { date: '2026-04-22', meal_name: 'dinner',    meal_ref: null, title: '' },
      { date: '2026-04-23', meal_name: 'breakfast', meal_ref: null, title: '' },
    ];
    service.setMealPlan({ plan_start: '2026-04-22', meals: fakeMeals });
    expect(service.totalMeals()).toBe(4);
  });

  it('totalMeals reflects caller-filtered list — food spoke must exclude skipped slots before setMealPlan', () => {
    // MealEntry has no skipped field; the server schema enforces this via additionalProperties:false.
    // The food spoke's Meal Plan Review substep is responsible for filtering out client-side
    // skipped slots. This test documents that totalMeals counts whatever was passed to setMealPlan.
    const committed: MealEntry[] = [
      { date: '2026-04-22', meal_name: 'breakfast', meal_ref: null, title: '' },
      { date: '2026-04-22', meal_name: 'lunch',     meal_ref: null, title: '' },
      // dinner was skipped by the user — food spoke excludes it before calling setMealPlan
    ];
    service.setMealPlan({ plan_start: '2026-04-22', meals: committed });
    expect(service.totalMeals()).toBe(2); // not 3 (the server proposed 3, user skipped dinner)
  });

  it('planDays is 0 when no plan period is set', () => {
    expect(service.planDays()).toBe(0);
  });

  it('planDays counts the inclusive span of the first window', () => {
    prefsSignal.set({
      user_id: 'u1', week_start_day: 1,
      planning_trigger_offset: -1, default_plan_length_days: 7,
      email_notifications_enabled: false, sms_notifications_enabled: false,
      push_notifications_enabled: false, phone_number: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-22');
    // Thu 2026-04-23 – Sun 2026-04-26 → 4 inclusive days.
    expect(service.planDays()).toBe(4);
  });

  it('planDays counts the inclusive span of a 14-day-length first window', () => {
    prefsSignal.set({
      user_id: 'u1', week_start_day: 1,
      planning_trigger_offset: -2, default_plan_length_days: 14,
      email_notifications_enabled: false, sms_notifications_enabled: false,
      push_notifications_enabled: false, phone_number: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-22');
    // Thu 2026-04-23 – Sun 2026-05-03 → 11 inclusive days.
    expect(service.planDays()).toBe(11);
  });

  it('planDays reflects the extended span when the window rolls into the following week', () => {
    prefsSignal.set({
      user_id: 'u1', week_start_day: 1,
      planning_trigger_offset: -1, default_plan_length_days: 7,
      email_notifications_enabled: false, sms_notifications_enabled: false,
      push_notifications_enabled: false, phone_number: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-25');
    // today=Sat 2026-04-25 → plan_start=Sun 2026-04-26 (last day of week) → roll-over
    // to Sun 2026-05-03 → 8 inclusive days.
    expect(service.planDays()).toBe(8);
  });
});

describe('computeFirstPlanPeriod', () => {
  // All cases use a Monday-start week (week_start_day=1) unless noted.
  // plan_start is always the day AFTER `today`.

  it('normal mid-week: plans from tomorrow to the end of the current week', () => {
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; week Mon–Sun ends Sun 2026-04-26.
    // offset=-1 → trigger Sun 2026-04-26, ratio 3/7=0.43 ≥ 0.15 → normal.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 7, planning_trigger_offset: -1, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-04-26');
  });

  it('onboarding on the week-start day still starts tomorrow', () => {
    // today=Mon 2026-04-20 → plan_start=Tue 2026-04-21; week ends Sun 2026-04-26.
    const result = computeFirstPlanPeriod('2026-04-20', {
      default_plan_length_days: 7, planning_trigger_offset: -1, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-21');
    expect(result.end).toBe('2026-04-26');
  });

  it('rolls into the following week when little of the current week remains', () => {
    // today=Sat 2026-04-25 → plan_start=Sun 2026-04-26 (last day of week).
    // trigger Sun 2026-04-26, days_until_trigger=0, ratio 0 < 0.15 → extend.
    const result = computeFirstPlanPeriod('2026-04-25', {
      default_plan_length_days: 7, planning_trigger_offset: -1, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-26');
    expect(result.end).toBe('2026-05-03');
  });

  it('onboarding on the last day of the week starts a full following week', () => {
    // today=Sun 2026-04-26 → plan_start=Mon 2026-04-27 (next week start) → Mon–Sun.
    const result = computeFirstPlanPeriod('2026-04-26', {
      default_plan_length_days: 7, planning_trigger_offset: -1, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-27');
    expect(result.end).toBe('2026-05-03');
  });

  it('respects a non-Monday week_start_day (Sunday-start week)', () => {
    // week_start_day=0 (Sun). today=Wed 2026-04-22 → plan_start=Thu 2026-04-23.
    // week Sun 2026-04-19 – Sat 2026-04-25; trigger Sat 2026-04-25, ratio 2/7 ≥ 0.15 → normal.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 7, planning_trigger_offset: -1, week_start_day: 0,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-04-25');
  });

  it('works with a 14-day plan length', () => {
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; 14-day period Mon 2026-04-20 – Sun 2026-05-03.
    // offset=-2 → trigger Sat 2026-05-02, ratio 9/14 ≥ 0.15 → normal.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 14, planning_trigger_offset: -2, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-05-03');
  });

  it('threshold: ratio >= 0.15 stays in the current week (offset=-2)', () => {
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; trigger Sat 2026-04-25,
    // days_until_trigger=2, ratio 2/7=0.286 ≥ 0.15 → normal.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 7, planning_trigger_offset: -2, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-04-26');
  });

  it('threshold: ratio < 0.15 rolls into the following week (offset=-3)', () => {
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; trigger Fri 2026-04-24,
    // days_until_trigger=1, ratio 1/7=0.143 < 0.15 → extend.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 7, planning_trigger_offset: -3, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-05-03');
  });

  it('large negative offset lands in the roll-over branch, not a clamp', () => {
    // today=Wed 2026-04-22 → plan_start=Thu 2026-04-23; trigger 2026-04-17,
    // days_until_trigger=-6 < 0.15·7 → extend to following week end 2026-05-03.
    const result = computeFirstPlanPeriod('2026-04-22', {
      default_plan_length_days: 7, planning_trigger_offset: -10, week_start_day: 1,
    });
    expect(result.start).toBe('2026-04-23');
    expect(result.end).toBe('2026-05-03');
  });
});
