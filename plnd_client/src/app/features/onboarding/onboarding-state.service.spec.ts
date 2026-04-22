// plnd_client/src/app/features/onboarding/onboarding-state.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { OnboardingStateService, computeFirstPlanPeriod, SectionId } from './onboarding-state.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { UserPreferences } from '../../core/models/preferences';

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
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    service.computeAndSetPlanPeriod('2026-04-22');
    const period = service.planPeriod();
    expect(period).not.toBeNull();
    expect(period!.start).toBe('2026-04-22');
    expect(period!.end).toBe('2026-04-29'); // offset=-3 → ratio 4/7 = 0.57 ≥ 0.15 → normal case
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
});
