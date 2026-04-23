import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { DietaryPreferencesSubstepComponent } from './dietary-preferences-substep';
import { DietaryRestrictionsService } from '../../../../../core/services/dietary-restrictions.service';
import { UserMealsService } from '../../../../../core/services/user-meals.service';
import { of } from 'rxjs';

describe('DietaryPreferencesSubstepComponent', () => {
  let component: DietaryPreferencesSubstepComponent;
  let fixture: ComponentFixture<DietaryPreferencesSubstepComponent>;
  let mealsSvc: jasmine.SpyObj<UserMealsService>;
  let restrictionsSvc: jasmine.SpyObj<DietaryRestrictionsService>;

  beforeEach(async () => {
    mealsSvc = jasmine.createSpyObj('UserMealsService', ['createFromScratch', 'updateMetadata']);
    restrictionsSvc = jasmine.createSpyObj('DietaryRestrictionsService', ['create']);

    await TestBed.configureTestingModule({
      imports: [DietaryPreferencesSubstepComponent],
      providers: [
        { provide: UserMealsService, useValue: mealsSvc },
        { provide: DietaryRestrictionsService, useValue: restrictionsSvc },
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
