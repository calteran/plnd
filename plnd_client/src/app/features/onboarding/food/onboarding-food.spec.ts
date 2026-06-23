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

  function buildMocks(planningPrefsComplete: boolean, dayTypes: unknown[] = []) {
    const mockState = createSpyObj(['markComplete', 'setMealPlan', 'setPlanningPrefsComplete', 'computeAndSetPlanPeriod'],
      {
        planningPrefsComplete: vi.fn().mockReturnValue(planningPrefsComplete),
        planPeriod: vi.fn().mockReturnValue(null),
        dayTypes: vi.fn().mockReturnValue(dayTypes),
      });
    const mockWPS = createSpyObj(['initSession'], {
      planStart: vi.fn().mockReturnValue(''),
      planEnd: vi.fn().mockReturnValue(''),
      isGenerating: vi.fn().mockReturnValue(false),
      horizonDays: vi.fn().mockReturnValue([]),
      scheduledMeals: vi.fn().mockReturnValue({}),
    });
    const mockPrefs = createSpyObj(['loadPreferences'], {
      preferences: vi.fn().mockReturnValue(null),
    });
    return { mockState, mockWPS, mockPrefs };
  }

  async function setup(planningPrefsComplete = false, dayTypes: unknown[] = []) {
    const { mockState, mockWPS, mockPrefs } = buildMocks(planningPrefsComplete, dayTypes);
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
});
