import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { UserDishesService } from './user-dishes.service';
import { UserDishPref } from '../models/user-dish-pref';

const MOCK_DISH: UserDishPref = {
  user_dish_pref_id: 'pref-1',
  user_id: 'user-1',
  catalog_dish_id: 'cat-dish-1',
  user_dish_id: null,
  name: 'Chicken Stir Fry',
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

describe('UserDishesService', () => {
  let service: UserDishesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
    });
    service = TestBed.inject(UserDishesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('load() sets the dishes signal', () => {
    service.load();

    const req = httpMock.expectOne(r => r.url.endsWith('/my/dishes') && r.method === 'GET');
    req.flush([MOCK_DISH]);

    expect(service.dishes().length).toBe(1);
    expect(service.dishes()[0].name).toBe('Chicken Stir Fry');
  });

  it('load() no-op guard: second call makes no HTTP request', () => {
    service.load();
    service.load();

    const reqs = httpMock.match(r => r.url.endsWith('/my/dishes') && r.method === 'GET');
    expect(reqs.length).toBe(1);
    reqs[0].flush([MOCK_DISH]);
  });

  it('addFromCatalog() sends POST and appends to dishes signal', () => {
    let result: UserDishPref | undefined;
    service.addFromCatalog('cat-dish-1').subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/my/dishes') && r.method === 'POST');
    expect(req.request.body).toEqual({ catalog_dish_id: 'cat-dish-1' });
    req.flush(MOCK_DISH);

    expect(result?.source).toBe('catalog');
    expect(service.dishes().length).toBe(1);
    expect(service.dishes()[0].source).toBe('catalog');
  });

  it('addFromCatalog() 409 propagates as error and leaves signal unchanged', () => {
    let errorReceived: HttpErrorResponse | null = null;
    service.addFromCatalog('cat-dish-1').subscribe({
      error: (e: HttpErrorResponse) => { errorReceived = e; },
    });

    const req = httpMock.expectOne(r => r.url.endsWith('/my/dishes') && r.method === 'POST');
    req.flush({ error: 'conflict' }, { status: 409, statusText: 'Conflict' });

    expect(errorReceived).not.toBeNull();
    expect(errorReceived!.status).toBe(409);
    expect(service.dishes().length).toBe(0);
  });

  it('updateRecipe() sends PATCH and replaces entry in signal', () => {
    const svc = service as unknown as { _dishes: { set: (v: UserDishPref[]) => void } };
    svc._dishes.set([MOCK_DISH]);

    const updated: UserDishPref = {
      ...MOCK_DISH,
      has_personal_recipe: true,
      source: 'personal',
      user_dish_id: 'ud-1',
      name: 'Modified Stir Fry',
    };

    let result: UserDishPref | undefined;
    service.updateRecipe('pref-1', { name: 'Modified Stir Fry' }).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/my/dishes/pref-1') && r.method === 'PATCH');
    expect(req.request.body).toEqual({ name: 'Modified Stir Fry' });
    req.flush(updated);

    expect(result?.has_personal_recipe).toBeTrue();
    expect(service.dishes()[0].has_personal_recipe).toBeTrue();
    expect(service.dishes()[0].source).toBe('personal');
  });

  it('updateMetadata() sends PATCH and replaces entry in signal', () => {
    const svc = service as unknown as { _dishes: { set: (v: UserDishPref[]) => void } };
    svc._dishes.set([MOCK_DISH]);

    const updated: UserDishPref = { ...MOCK_DISH, rating: 5, notes: 'Great dish' };
    let result: UserDishPref | undefined;
    service.updateMetadata('pref-1', { rating: 5, notes: 'Great dish' }).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/my/dishes/pref-1') && r.method === 'PATCH');
    req.flush(updated);

    expect(result?.rating).toBe(5);
    expect(service.dishes()[0].rating).toBe(5);
  });

  it('remove() sends DELETE and filters the dishes signal', () => {
    const svc = service as unknown as { _dishes: { set: (v: UserDishPref[]) => void } };
    svc._dishes.set([MOCK_DISH]);

    service.remove('pref-1').subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/my/dishes/pref-1') && r.method === 'DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(service.dishes().length).toBe(0);
  });

  it('clear() resets dishes signal to [] and allows load() again', () => {
    const svc = service as unknown as { _dishes: { set: (v: UserDishPref[]) => void } };
    svc._dishes.set([MOCK_DISH]);

    service.clear();
    expect(service.dishes().length).toBe(0);

    // load() should now make a real HTTP request (not no-op)
    service.load();
    const req = httpMock.expectOne(r => r.url.endsWith('/my/dishes') && r.method === 'GET');
    req.flush([]);
  });
});
