import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { UserIngredientPrefsService } from './user-ingredient-prefs.service';
import { UserIngredientPref } from '../models/user-ingredient-pref';

const MOCK_PREF: UserIngredientPref = {
  user_ingredient_pref_id: 'pref-1',
  user_id: 'user-1',
  catalog_ingredient_id: 'ing-1',
  preference_score: 0,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('UserIngredientPrefsService', () => {
  let service: UserIngredientPrefsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UserIngredientPrefsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('load() sets the prefs signal', () => {
    service.load();

    const req = httpMock.expectOne(r => r.url.endsWith('/my/ingredient-prefs') && r.method === 'GET');
    req.flush([MOCK_PREF]);

    expect(service.prefs().length).toBe(1);
    expect(service.prefs()[0].catalog_ingredient_id).toBe('ing-1');
  });

  it('load() no-op guard: second call makes no HTTP request', () => {
    service.load();
    service.load(); // second call should be no-op

    const reqs = httpMock.match(r => r.url.endsWith('/my/ingredient-prefs'));
    expect(reqs.length).toBe(1);
    reqs[0].flush([MOCK_PREF]);
  });

  it('upsert() sends PUT and updates the prefs signal (existing entry)', () => {
    // Pre-seed signal
    const svc = service as unknown as { _prefs: { set: (v: UserIngredientPref[]) => void } };
    svc._prefs.set([MOCK_PREF]);

    let result: UserIngredientPref | undefined;
    service.upsert('ing-1', { preference_score: -2 }).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/my/ingredient-prefs/ing-1') && r.method === 'PUT');
    expect(req.request.body).toEqual({ preference_score: -2 });
    req.flush({ ...MOCK_PREF, preference_score: -2 });

    expect(result?.preference_score).toBe(-2);
    expect(service.prefs()[0].preference_score).toBe(-2);
  });

  it('upsert() appends to signal when entry is new', () => {
    let result: UserIngredientPref | undefined;
    service.upsert('ing-2', { preference_score: 1 }).subscribe(r => (result = r));

    const newPref: UserIngredientPref = { ...MOCK_PREF, user_ingredient_pref_id: 'pref-2', catalog_ingredient_id: 'ing-2' };
    const req = httpMock.expectOne(r => r.url.endsWith('/my/ingredient-prefs/ing-2') && r.method === 'PUT');
    req.flush(newPref);

    expect(result?.catalog_ingredient_id).toBe('ing-2');
    expect(service.prefs().length).toBe(1);
    expect(service.prefs()[0].catalog_ingredient_id).toBe('ing-2');
  });

  it('remove() sends DELETE and filters the prefs signal', () => {
    const svc = service as unknown as { _prefs: { set: (v: UserIngredientPref[]) => void } };
    svc._prefs.set([MOCK_PREF]);

    service.remove('ing-1').subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/my/ingredient-prefs/ing-1') && r.method === 'DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(service.prefs().length).toBe(0);
  });

  it('clear() resets signal to [] and allows load() again', () => {
    const svc = service as unknown as { _prefs: { set: (v: UserIngredientPref[]) => void } };
    svc._prefs.set([MOCK_PREF]);

    service.clear();
    expect(service.prefs().length).toBe(0);

    // load() should now make a real HTTP request (not no-op)
    service.load();
    const req = httpMock.expectOne(r => r.url.endsWith('/my/ingredient-prefs'));
    req.flush([]);
  });
});
