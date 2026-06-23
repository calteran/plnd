import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { UserMealsService } from './user-meals.service';
import { UserMealPref } from '../models/user-meal-pref';

const MOCK_MEAL: UserMealPref = {
  user_meal_pref_id: 'meal-pref-1',
  user_id: 'user-1',
  catalog_meal_id: 'cat-meal-1',
  user_meal_id: null,
  name: 'Breakfast Bowl',
  source: 'catalog',
  has_personal_recipe: false,
  rating: null,
  is_safe_food: false,
  is_blocked: false,
  notes: null,
  origin_external_source: 'themealdb',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('UserMealsService', () => {
  let service: UserMealsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UserMealsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('load() sets the meals signal', () => {
    service.load();

    const req = httpMock.expectOne(r => r.url.endsWith('/my/meals') && r.method === 'GET');
    req.flush([MOCK_MEAL]);

    expect(service.meals().length).toBe(1);
    expect(service.meals()[0].name).toBe('Breakfast Bowl');
  });

  it('load() no-op guard: second call makes no HTTP request', () => {
    service.load();
    service.load();

    const reqs = httpMock.match(r => r.url.endsWith('/my/meals') && r.method === 'GET');
    expect(reqs.length).toBe(1);
    reqs[0].flush([MOCK_MEAL]);
  });

  it('addFromCatalog() sends POST and appends to meals signal', () => {
    let result: UserMealPref | undefined;
    service.addFromCatalog('cat-meal-1').subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/my/meals') && r.method === 'POST');
    expect(req.request.body).toEqual({ catalog_meal_id: 'cat-meal-1' });
    req.flush(MOCK_MEAL);

    expect(result?.source).toBe('catalog');
    expect(service.meals().length).toBe(1);
    expect(service.meals()[0].source).toBe('catalog');
  });

  it('updateRecipe() sends PATCH and replaces entry in signal', () => {
    const svc = service as unknown as { _meals: { set: (v: UserMealPref[]) => void } };
    svc._meals.set([MOCK_MEAL]);

    const updated: UserMealPref = {
      ...MOCK_MEAL,
      has_personal_recipe: true,
      source: 'personal',
      user_meal_id: 'um-1',
      name: 'Custom Breakfast Bowl',
    };

    let result: UserMealPref | undefined;
    service.updateRecipe('meal-pref-1', { name: 'Custom Breakfast Bowl' }).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/my/meals/meal-pref-1') && r.method === 'PATCH');
    expect(req.request.body).toEqual({ name: 'Custom Breakfast Bowl' });
    req.flush(updated);

    expect(result?.has_personal_recipe).toBe(true);
    expect(service.meals()[0].has_personal_recipe).toBe(true);
    expect(service.meals()[0].source).toBe('personal');
  });

  it('updateMetadata() sends PATCH and replaces entry in signal', () => {
    const svc = service as unknown as { _meals: { set: (v: UserMealPref[]) => void } };
    svc._meals.set([MOCK_MEAL]);

    const updated: UserMealPref = { ...MOCK_MEAL, rating: 4, is_safe_food: true };
    let result: UserMealPref | undefined;
    service.updateMetadata('meal-pref-1', { rating: 4, is_safe_food: true }).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/my/meals/meal-pref-1') && r.method === 'PATCH');
    req.flush(updated);

    expect(result?.rating).toBe(4);
    expect(service.meals()[0].is_safe_food).toBe(true);
  });

  it('remove() sends DELETE and filters the meals signal', () => {
    const svc = service as unknown as { _meals: { set: (v: UserMealPref[]) => void } };
    svc._meals.set([MOCK_MEAL]);

    service.remove('meal-pref-1').subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/my/meals/meal-pref-1') && r.method === 'DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(service.meals().length).toBe(0);
  });

  it('clear() resets meals signal to [] and allows load() again', () => {
    const svc = service as unknown as { _meals: { set: (v: UserMealPref[]) => void } };
    svc._meals.set([MOCK_MEAL]);

    service.clear();
    expect(service.meals().length).toBe(0);

    // load() should now make a real HTTP request (not no-op)
    service.load();
    const req = httpMock.expectOne(r => r.url.endsWith('/my/meals') && r.method === 'GET');
    req.flush([]);
  });
});
