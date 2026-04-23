import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { SessionStateService } from './session-state.service';
import { UserService } from './user.service';
import { PreferencesService } from './preferences.service';
import { DietaryRestrictionsService } from './dietary-restrictions.service';
import { UserDishesService } from './user-dishes.service';
import { UserMealsService } from './user-meals.service';
import { UserIngredientPrefsService } from './user-ingredient-prefs.service';
import { WeekPlanService } from './week-plan.service';

describe('SessionStateService', () => {
  let service: SessionStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(SessionStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('clearAll() calls clearUser() on UserService', () => {
    const userService = TestBed.inject(UserService);
    spyOn(userService, 'clearUser');
    service.clearAll();
    expect(userService.clearUser).toHaveBeenCalled();
  });

  it('clearAll() calls clearPreferences() on PreferencesService', () => {
    const prefsService = TestBed.inject(PreferencesService);
    spyOn(prefsService, 'clearPreferences');
    service.clearAll();
    expect(prefsService.clearPreferences).toHaveBeenCalled();
  });

  it('clearAll() calls clear() on DietaryRestrictionsService', () => {
    const dietaryService = TestBed.inject(DietaryRestrictionsService);
    spyOn(dietaryService, 'clear');
    service.clearAll();
    expect(dietaryService.clear).toHaveBeenCalled();
  });

  it('clearAll() calls clear() on UserDishesService', () => {
    const userDishesService = TestBed.inject(UserDishesService);
    spyOn(userDishesService, 'clear');
    service.clearAll();
    expect(userDishesService.clear).toHaveBeenCalled();
  });

  it('clearAll() calls clear() on UserMealsService', () => {
    const userMealsService = TestBed.inject(UserMealsService);
    spyOn(userMealsService, 'clear');
    service.clearAll();
    expect(userMealsService.clear).toHaveBeenCalled();
  });

  it('clearAll() calls clear() on UserIngredientPrefsService', () => {
    const userIngredientPrefsService = TestBed.inject(UserIngredientPrefsService);
    spyOn(userIngredientPrefsService, 'clear');
    service.clearAll();
    expect(userIngredientPrefsService.clear).toHaveBeenCalled();
  });

  it('clearAll() calls clear() on WeekPlanService', () => {
    const weekPlanService = TestBed.inject(WeekPlanService);
    spyOn(weekPlanService, 'clear');
    service.clearAll();
    expect(weekPlanService.clear).toHaveBeenCalled();
  });
});
