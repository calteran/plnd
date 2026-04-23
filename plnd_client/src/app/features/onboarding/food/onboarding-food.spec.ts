import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OnboardingFoodComponent } from './onboarding-food';
import { OnboardingStateService } from '../onboarding-state.service';
import { WeekPlanService } from '../../../core/services/week-plan.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { DietaryRestrictionsService } from '../../../core/services/dietary-restrictions.service';
import { MealHabitsService } from '../../../core/services/meal-habits.service';
import { UserMealsService } from '../../../core/services/user-meals.service';

describe('OnboardingFoodComponent', () => {
  let fixture: ComponentFixture<OnboardingFoodComponent>;
  let component: OnboardingFoodComponent;

  function buildMocks(planningPrefsComplete: boolean) {
    const mockState = jasmine.createSpyObj('OnboardingStateService',
      ['markComplete', 'setMealPlan', 'setPlanningPrefsComplete', 'computeAndSetPlanPeriod', 'setMealHabits'],
      {
        planningPrefsComplete: jasmine.createSpy().and.returnValue(planningPrefsComplete),
        planPeriod: jasmine.createSpy().and.returnValue(null),
      });
    const mockWPS = jasmine.createSpyObj('WeekPlanService', ['initSession'], {
      planStart: jasmine.createSpy().and.returnValue(''),
      planEnd: jasmine.createSpy().and.returnValue(''),
      isGenerating: jasmine.createSpy().and.returnValue(false),
      horizonDays: jasmine.createSpy().and.returnValue([]),
      scheduledMeals: jasmine.createSpy().and.returnValue({}),
    });
    const mockPrefs = jasmine.createSpyObj('PreferencesService', ['loadPreferences'], {
      preferences: jasmine.createSpy().and.returnValue(null),
    });
    return { mockState, mockWPS, mockPrefs };
  }

  async function setup(planningPrefsComplete = false) {
    const { mockState, mockWPS, mockPrefs } = buildMocks(planningPrefsComplete);
    await TestBed.configureTestingModule({
      imports: [OnboardingFoodComponent],
      providers: [
        provideRouter([]),
        { provide: OnboardingStateService, useValue: mockState },
        { provide: WeekPlanService, useValue: mockWPS },
        { provide: PreferencesService, useValue: mockPrefs },
        { provide: DietaryRestrictionsService, useValue: jasmine.createSpyObj('DRS', ['load', 'create', 'update', 'delete'], { restrictions: () => [] }) },
        { provide: MealHabitsService, useValue: jasmine.createSpyObj('MHS', ['load', 'create', 'delete'], { habits: () => [] }) },
        { provide: UserMealsService, useValue: jasmine.createSpyObj('UMS', ['createFromScratch', 'updateMetadata']) },
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

  it('starts at internalStep 0 when planningPrefsComplete is false', async () => {
    await setup(false);
    expect(component.internalStep()).toBe(0);
  });

  it('starts at internalStep 1 when planningPrefsComplete is true', async () => {
    await setup(true);
    expect(component.internalStep()).toBe(1);
  });

  it('advance() increments internalStep up to 5', async () => {
    await setup();
    expect(component.internalStep()).toBe(0);
    component.advance();
    expect(component.internalStep()).toBe(1);
    for (let i = 0; i < 10; i++) component.advance();
    expect(component.internalStep()).toBe(5);
  });

  it('onBack() decrements internalStep but not below min', async () => {
    await setup(false);
    component.advance();
    component.onBack();
    expect(component.internalStep()).toBe(0);
    component.onBack(); // already at min
    expect(component.internalStep()).toBe(0);
  });
});
