import { Injectable, inject } from '@angular/core';
import { UserService } from './user.service';
import { PreferencesService } from './preferences.service';
import { DietaryRestrictionsService } from './dietary-restrictions.service';
import { UserDishesService } from './user-dishes.service';
import { UserMealsService } from './user-meals.service';
import { UserIngredientPrefsService } from './user-ingredient-prefs.service';
import { WeekPlanService } from './week-plan.service';
import { ScheduleTemplatesService } from './schedule-templates.service';

@Injectable({ providedIn: 'root' })
export class SessionStateService {
  private readonly userService = inject(UserService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly dietaryRestrictionsService = inject(DietaryRestrictionsService);
  private readonly userDishesService = inject(UserDishesService);
  private readonly userMealsService = inject(UserMealsService);
  private readonly userIngredientPrefsService = inject(UserIngredientPrefsService);
  private readonly weekPlanService = inject(WeekPlanService);
  private readonly scheduleTemplatesService = inject(ScheduleTemplatesService);

  clearAll(): void {
    this.userService.clearUser();
    this.preferencesService.clearPreferences();
    this.dietaryRestrictionsService.clear();
    this.userDishesService.clear();
    this.userMealsService.clear();
    this.userIngredientPrefsService.clear();
    this.weekPlanService.clear();
    this.scheduleTemplatesService.clear();
  }
}
