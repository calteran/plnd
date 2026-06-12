import { signal } from '@angular/core';
import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { DietaryPreferencesSubstepComponent } from './dietary-preferences-substep';
import { CatalogService } from '../../../../../core/services/catalog.service';
import { DietaryRestrictionsService } from '../../../../../core/services/dietary-restrictions.service';
import { UserIngredientPrefsService } from '../../../../../core/services/user-ingredient-prefs.service';
import { UserMealsService } from '../../../../../core/services/user-meals.service';
import { of, Subject } from 'rxjs';

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

    catalogSvc = jasmine.createSpyObj('CatalogService', ['searchIngredients', 'promoteIngredient']);
    catalogSvc.searchIngredients.and.returnValue(
      of({ local: [], external: [], providers_queried: [], providers_from_cache: [] })
    );
    catalogSvc.promoteIngredient.and.returnValue(of({ ingredient_id: 'promoted-1' }));

    ingredientPrefsSvc = jasmine.createSpyObj('UserIngredientPrefsService', ['upsert', 'remove', 'load']);
    Object.defineProperty(ingredientPrefsSvc, 'prefs', { value: signal([]), configurable: true });
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

  it('renders an amber chip for a custom lifestyle added while the section is expanded', () => {
    component.lifestyleExpanded.set(true);
    component.customLifestyleInput.set('low FODMAP');
    component.addCustomLifestyle();
    fixture.detectChanges();

    const amberChips = Array.from(
      fixture.nativeElement.querySelectorAll('.chip--amber') as NodeListOf<HTMLElement>
    );
    const customChip = amberChips.find(c => c.textContent?.includes('low FODMAP'));
    expect(customChip).withContext('expected an amber chip showing the custom lifestyle').toBeTruthy();
  });

  it('addIngredientRating() calls upsert with correct score mapping and adds to local list', fakeAsync(() => {
    component.ingredientInput.set('Oats');
    component.pendingIngredientId.set('ing-1');
    component.pendingIngredientScore.set(4); // index 4 = 😍 → preference_score +2

    component.addIngredientRating();
    tick();
    flush(); // drain the debounced search-cancel timer from resetIngredientEntry()

    expect(ingredientPrefsSvc.upsert).toHaveBeenCalledWith('ing-1', { preference_score: 2 });
    expect(component.ingredientRatings().length).toBe(1);
    expect(component.ingredientRatings()[0]).toEqual({ name: 'Oats', score: 4, catalogIngredientId: 'ing-1' });
    expect(component.ingredientInput()).toBe('');
    expect(component.pendingIngredientScore()).toBeNull();
    expect(component.pendingIngredientId()).toBeNull();
  }));

  it('addIngredientRating() dismisses the search dropdown after a catalog add', fakeAsync(() => {
    component.ingredientSearchResults.set([
      { kind: 'local', ingredient_id: 'ing-1', name: 'Oats', allergens: [] },
    ]);
    component.ingredientInput.set('Oats');
    component.pendingIngredientId.set('ing-1');
    component.pendingIngredientScore.set(4);

    component.addIngredientRating();
    tick();
    flush(); // let any in-flight debounced search resolve

    expect(component.ingredientSearchResults()).toEqual([]);
  }));

  it('addIngredientRating() dismisses the search dropdown after a free-text add', fakeAsync(() => {
    component.ingredientSearchResults.set([
      { kind: 'local', ingredient_id: 'ing-9', name: 'Cheese product', allergens: [] },
    ]);
    component.ingredientInput.set('Unknown thing');
    component.pendingIngredientScore.set(3);

    component.addIngredientRating();
    tick();
    flush(); // let any in-flight debounced search resolve

    expect(component.ingredientSearchResults()).toEqual([]);
  }));

  it('addIngredientRating() stores free-text entry locally without calling upsert when no catalog ID', fakeAsync(() => {
    component.ingredientInput.set('Unknown thing');
    component.pendingIngredientScore.set(3);
    // pendingIngredientId is null by default

    component.addIngredientRating();
    tick();
    flush(); // drain the debounced search-cancel timer from resetIngredientEntry()

    expect(ingredientPrefsSvc.upsert).not.toHaveBeenCalled();
    expect(component.ingredientRatings().length).toBe(1);
    expect(component.ingredientRatings()[0]).toEqual({ name: 'Unknown thing', score: 3, catalogIngredientId: null });
    expect(component.ingredientInput()).toBe('');
    expect(component.pendingIngredientScore()).toBeNull();
  }));

  it('removeIngredientRating() removes only the free-text entry and not a catalog entry with the same name', fakeAsync(() => {
    component['ingredientRatings'].set([
      { name: 'Oats', score: 4, catalogIngredientId: 'ing-1' },
      { name: 'Oats', score: 2, catalogIngredientId: null },
    ]);

    component.removeIngredientRating({ name: 'Oats', score: 2, catalogIngredientId: null });

    expect(component.ingredientRatings().length).toBe(1);
    expect(component.ingredientRatings()[0].catalogIngredientId).toBe('ing-1');
    expect(ingredientPrefsSvc.remove).not.toHaveBeenCalled();
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

  it('merges external results into the dropdown after local ones', fakeAsync(() => {
    catalogSvc.searchIngredients.and.returnValue(of({
      local: [{ ingredient_id: 'loc-1', name: 'Cheese, cheddar', description: null, allergens: [], occasion_tags: [], external_source: null }],
      external: [{ external_id: '99', name: 'Cheese, mozzarella', description: null, thumbnail_url: null }],
      providers_queried: ['usda_fdc'], providers_from_cache: [],
    }));
    component.onIngredientInput('cheese');
    tick(300); // debounce
    flush();
    const rows = component.ingredientSearchResults();
    expect(rows.length).toBe(2);
    expect(rows[0].kind).toBe('local');
    expect(rows[1].kind).toBe('external');
  }));

  it('selecting an external result promotes it then sets the catalog id', fakeAsync(() => {
    component.selectIngredientResult({ kind: 'external', external_source: 'usda_fdc', external_id: '99', name: 'Cheese, mozzarella', allergens: [] });
    flush();
    expect(catalogSvc.promoteIngredient).toHaveBeenCalledWith({ external_source: 'usda_fdc', external_id: '99' });
    expect(component.pendingIngredientId()).toBe('promoted-1');
    expect(component.ingredientInput()).toBe('Cheese, mozzarella');
  }));

  it('editing the field cancels an in-flight promote so no stale catalog id is applied', fakeAsync(() => {
    const promote$ = new Subject<{ ingredient_id: string }>();
    catalogSvc.promoteIngredient.and.returnValue(promote$.asObservable());

    component.selectIngredientResult({ kind: 'external', external_source: 'usda_fdc', external_id: '99', name: 'Cheese, mozzarella', allergens: [] });
    // User starts typing a different ingredient before the promote resolves.
    component.onIngredientInput('chedd');
    // The late promote response must be ignored (cancelled).
    promote$.next({ ingredient_id: 'promoted-1' });
    promote$.complete();
    flush();

    expect(component.pendingIngredientId()).toBeNull();
  }));
});
