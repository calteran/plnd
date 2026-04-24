import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { DietaryPreferencesSubstepComponent } from './dietary-preferences-substep';
import { CatalogService } from '../../../../../core/services/catalog.service';
import { DietaryRestrictionsService } from '../../../../../core/services/dietary-restrictions.service';
import { UserIngredientPrefsService } from '../../../../../core/services/user-ingredient-prefs.service';
import { UserMealsService } from '../../../../../core/services/user-meals.service';
import { of } from 'rxjs';

describe('DietaryPreferencesSubstepComponent', () => {
  let component: DietaryPreferencesSubstepComponent;
  let fixture: ComponentFixture<DietaryPreferencesSubstepComponent>;
  let mealsSvc: jasmine.SpyObj<UserMealsService>;
  let restrictionsSvc: jasmine.SpyObj<DietaryRestrictionsService>;
  let catalogSvc: jasmine.SpyObj<CatalogService>;
  let ingredientPrefsSvc: jasmine.SpyObj<UserIngredientPrefsService>;

  beforeEach(async () => {
    mealsSvc = jasmine.createSpyObj('UserMealsService', ['createFromScratch', 'updateMetadata']);
    restrictionsSvc = jasmine.createSpyObj('DietaryRestrictionsService', ['create', 'load', 'restrictions']);
    restrictionsSvc.restrictions.and.returnValue(null);

    catalogSvc = jasmine.createSpyObj('CatalogService', ['searchIngredients']);
    catalogSvc.searchIngredients.and.returnValue(
      of({ local: [], external: [], providers_queried: [], providers_from_cache: [] })
    );

    ingredientPrefsSvc = jasmine.createSpyObj('UserIngredientPrefsService', ['upsert', 'remove']);
    ingredientPrefsSvc.upsert.and.returnValue(of({
      user_ingredient_pref_id: 'pref-1', user_id: 'u1',
      catalog_ingredient_id: 'ing-1', preference_score: 2,
      notes: null, created_at: '', updated_at: '',
    }));
    ingredientPrefsSvc.remove.and.returnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [DietaryPreferencesSubstepComponent],
      providers: [
        { provide: UserMealsService, useValue: mealsSvc },
        { provide: DietaryRestrictionsService, useValue: restrictionsSvc },
        { provide: CatalogService, useValue: catalogSvc },
        { provide: UserIngredientPrefsService, useValue: ingredientPrefsSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DietaryPreferencesSubstepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('lifestyle section starts collapsed', () => {
    expect(component.lifestyleExpanded()).toBe(false);
  });

  it('toggling a lifestyle chip adds it to selectedLifestyles; toggling again removes it', () => {
    component.toggleLifestyle('vegan');
    expect(component.selectedLifestyles()).toContain('vegan');
    component.toggleLifestyle('vegan');
    expect(component.selectedLifestyles()).not.toContain('vegan');
  });

  it('addIngredientRating() calls upsert with correct score mapping and adds to local list', fakeAsync(() => {
    component.ingredientInput.set('Oats');
    component.pendingIngredientId.set('ing-1');
    component.pendingIngredientScore.set(4); // index 4 = 😍 → preference_score +2

    component.addIngredientRating();
    tick();

    expect(ingredientPrefsSvc.upsert).toHaveBeenCalledWith('ing-1', { preference_score: 2 });
    expect(component.ingredientRatings().length).toBe(1);
    expect(component.ingredientRatings()[0]).toEqual({ name: 'Oats', score: 4, catalogIngredientId: 'ing-1' });
    expect(component.ingredientInput()).toBe('');
    expect(component.pendingIngredientScore()).toBeNull();
    expect(component.pendingIngredientId()).toBeNull();
  }));

  it('addIngredientRating() does nothing when no catalog ID selected', fakeAsync(() => {
    component.ingredientInput.set('Unknown thing');
    component.pendingIngredientScore.set(3);
    // pendingIngredientId is null by default

    component.addIngredientRating();
    tick();

    expect(ingredientPrefsSvc.upsert).not.toHaveBeenCalled();
    expect(component.ingredientRatings().length).toBe(0);
  }));

  it('addMealRating() creates meal then updates metadata with correct rating', fakeAsync(() => {
    const mockMeal = {
      user_meal_pref_id: 'm1', user_id: 'u1', catalog_meal_id: null,
      user_meal_id: null, name: 'Pasta', source: 'personal' as const,
      has_personal_recipe: false, rating: null, is_safe_food: false,
      is_blocked: false, notes: null, origin_external_source: null,
      created_at: '', updated_at: '',
    };
    mealsSvc.createFromScratch.and.returnValue(of(mockMeal));
    mealsSvc.updateMetadata.and.returnValue(of({ ...mockMeal, rating: 5 }));

    component.mealInput.set('Pasta');
    component.pendingMealScore.set(4); // index 4 = 😍 = rating 5
    component.addMealRating();
    tick();

    expect(mealsSvc.createFromScratch).toHaveBeenCalledWith({ name: 'Pasta' });
    expect(mealsSvc.updateMetadata).toHaveBeenCalledWith('m1', { rating: 5 });
    expect(component.mealRatings().length).toBe(1);
    expect(component.mealRatings()[0]).toEqual({ name: 'Pasta', score: 4 });
  }));

  it('save() saves each selected lifestyle as a preference restriction and emits complete', fakeAsync(() => {
    restrictionsSvc.create.and.returnValue(of({
      restriction_id: 'r1', user_id: 'u1', restriction_type: 'preference',
      name: 'vegan', notes: null, created_at: '', updated_at: '',
    }));
    let completed = false;
    component.complete.subscribe(() => completed = true);

    component.toggleLifestyle('vegan');
    component.save();
    tick();

    expect(restrictionsSvc.create).toHaveBeenCalledWith({ restriction_type: 'preference', name: 'vegan' });
    expect(completed).toBe(true);
  }));

  it('save() emits complete immediately when no lifestyles selected', fakeAsync(() => {
    let completed = false;
    component.complete.subscribe(() => completed = true);
    component.save();
    tick();
    expect(completed).toBe(true);
    expect(restrictionsSvc.create).not.toHaveBeenCalled();
  }));
});
