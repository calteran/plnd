import { createSpyObj } from '../../../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OnboardingFoodComponent } from './onboarding-food';
import { OnboardingStateService } from '../onboarding-state.service';
import { WeekPlanService } from '../../../core/services/week-plan.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { DietaryRestrictionsService } from '../../../core/services/dietary-restrictions.service';
import { UserMealsService } from '../../../core/services/user-meals.service';
import { DayTypesService } from '../../../core/services/day-types.service';

describe('OnboardingFoodComponent', () => {
  let fixture: ComponentFixture<OnboardingFoodComponent>;
  let component: OnboardingFoodComponent;

  interface MealPlanOverrides {
    planStart?: string;
    horizonDays?: string[];
    scheduledMeals?: Record<string, unknown>;
  }

  function buildMocks(planningPrefsComplete: boolean, dayTypes: unknown[] = [], meal: MealPlanOverrides = {}) {
    const mockState = createSpyObj(['markComplete', 'setMealPlan', 'setPlanningPrefsComplete', 'computeAndSetPlanPeriod'],
      {
        planningPrefsComplete: vi.fn().mockReturnValue(planningPrefsComplete),
        planPeriod: vi.fn().mockReturnValue(null),
        dayTypes: vi.fn().mockReturnValue(dayTypes),
      });
    const mockWPS = createSpyObj(['initSession'], {
      planStart: vi.fn().mockReturnValue(meal.planStart ?? ''),
      planEnd: vi.fn().mockReturnValue(''),
      isGenerating: vi.fn().mockReturnValue(false),
      horizonDays: vi.fn().mockReturnValue(meal.horizonDays ?? []),
      scheduledMeals: vi.fn().mockReturnValue(meal.scheduledMeals ?? {}),
    });
    const mockPrefs = createSpyObj(['loadPreferences'], {
      preferences: vi.fn().mockReturnValue(null),
    });
    return { mockState, mockWPS, mockPrefs };
  }

  async function setup(planningPrefsComplete = false, dayTypes: unknown[] = [], meal: MealPlanOverrides = {}) {
    const { mockState, mockWPS, mockPrefs } = buildMocks(planningPrefsComplete, dayTypes, meal);
    await TestBed.configureTestingModule({
      imports: [OnboardingFoodComponent],
      providers: [
        provideRouter([]),
        { provide: OnboardingStateService, useValue: mockState },
        { provide: WeekPlanService, useValue: mockWPS },
        { provide: PreferencesService, useValue: mockPrefs },
        { provide: DietaryRestrictionsService, useValue: createSpyObj(['load', 'create', 'update', 'delete'], { restrictions: () => [] }) },
        { provide: UserMealsService, useValue: createSpyObj(['createFromScratch', 'updateMetadata']) },
        { provide: DayTypesService, useValue: createSpyObj(['list', 'listMeals', 'create', 'update', 'delete', 'createMeal', 'deleteMeal']) },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OnboardingFoodComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    return { mockState, mockWPS, mockPrefs };
  }

  it('renders SpokeChromeComponent containing "Food"', async () => {
    await setup();
    expect(fixture.nativeElement.textContent).toContain('Food');
  });

  it('starts at planning-prefs when planningPrefsComplete is false', async () => {
    await setup(false);
    expect(component.activeSubstep()).toBe('planning-prefs');
  });

  it('skips planning-prefs when already complete', async () => {
    await setup(true);
    expect(component.activeSubstep()).toBe('dietary-restrictions');
  });

  it('inserts the day-types substep before plan-meals when no day types exist', async () => {
    await setup(false, []);
    expect(component.substeps()).toEqual([
      'planning-prefs',
      'dietary-restrictions',
      'dietary-preferences',
      'day-types',
      'plan-meals',
    ]);
  });

  it('omits the day-types substep once day types are configured', async () => {
    await setup(false, [{ id: 'dt-1' }]);
    expect(component.substeps()).toEqual([
      'planning-prefs',
      'dietary-restrictions',
      'dietary-preferences',
      'plan-meals',
    ]);
  });

  it('routes dietary-preferences → day-types when day types are missing', async () => {
    await setup(false, []);
    component.activeSubstep.set('dietary-preferences');
    component.onSubstepComplete();
    expect(component.activeSubstep()).toBe('day-types');
  });

  it('routes dietary-preferences → plan-meals when day types already exist', async () => {
    await setup(false, [{ id: 'dt-1' }]);
    component.activeSubstep.set('dietary-preferences');
    component.onSubstepComplete();
    expect(component.activeSubstep()).toBe('plan-meals');
  });

  it('hides the chrome continue button on the day-types substep', async () => {
    await setup(false, []);
    component.activeSubstep.set('day-types');
    expect(component.showContinue()).toBe(false);
    component.activeSubstep.set('plan-meals');
    expect(component.showContinue()).toBe(true);
  });

  it('day-types → plan-meals on completion', async () => {
    await setup(false, []);
    component.activeSubstep.set('day-types');
    component.onSubstepComplete();
    expect(component.activeSubstep()).toBe('plan-meals');
  });

  // Regression: a custom-edited meal whose agent text-resolution round-trip has not
  // landed yet (or which the agent could not match) has approvalState 'approved' but a
  // null mealRef. finalSave() must still persist it (via its title) — otherwise the
  // user's last edit silently vanishes from the day view. Mirrors the weekly wizard's
  // buildCommitRequest / the hub's buildPlanRequest, which both keep null-ref meals.
  it('persists a custom-edited meal that has a title but no resolved mealRef', async () => {
    const date = '2026-06-30';
    const dayType = {
      is_cycle: false,
      days_bitmask: 0x7f, // every weekday → always covers `date`
      meals: [
        { name: 'Breakfast', sort_order: 0, preferred_time: '08:00:00' },
        { name: 'Lunch', sort_order: 1, preferred_time: '12:00:00' },
        { name: 'Dinner', sort_order: 2, preferred_time: '18:00:00' },
      ],
    };
    const scheduledMeals = {
      [date]: {
        Breakfast: { approvalState: 'approved', mealRef: { type: 'catalog', id: 'm-1' }, title: 'Oatmeal' },
        // The user's last edit: optimistic state, agent resolution still in flight.
        Dinner: { approvalState: 'approved', mealRef: null, title: 'Leftover spaghetti' },
      },
    };

    const { mockState } = await setup(true, [dayType], {
      planStart: date,
      horizonDays: [date],
      scheduledMeals,
    });

    component.activeSubstep.set('plan-meals');
    component.onContinue();

    expect(mockState.setMealPlan).toHaveBeenCalledTimes(1);
    const plan = mockState.setMealPlan.mock.calls[0][0];
    const dinner = plan.meals.find(
      (m: { meal_name: string }) => m.meal_name === 'Dinner',
    );
    expect(dinner).toBeDefined();
    expect(dinner.title).toBe('Leftover spaghetti');
    expect(dinner.meal_ref).toBeNull();
  });
});
