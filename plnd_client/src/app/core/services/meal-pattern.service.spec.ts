import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MealPatternService } from './meal-pattern.service';
import { ConfigService } from './config.service';
import { preferredTimeHHMM } from '../models/meal-pattern';

describe('preferredTimeHHMM', () => {
  it('extracts HH:MM from a Postgres TIME string', () => {
    expect(preferredTimeHHMM('08:00:00')).toBe('08:00');
    expect(preferredTimeHHMM('12:30:00')).toBe('12:30');
    expect(preferredTimeHHMM('23:59:59')).toBe('23:59');
  });
});

describe('MealPatternService', () => {
  let service: MealPatternService;
  let http: HttpTestingController;
  const BASE = 'http://localhost:3000';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { getConfig: () => ({ api: { baseUrl: BASE } }) } },
      ],
    });
    service = TestBed.inject(MealPatternService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('load() fetches /meal-pattern and populates signal', () => {
    service.load();
    const req = http.expectOne(`${BASE}/meal-pattern`);
    req.flush([{ id: '1', name: 'Breakfast', preferred_time: '08:00:00',
                 tolerance_minutes: 60, sort_order: 1 }]);
    expect(service.entries().length).toBe(1);
    expect(service.entries()[0].name).toBe('Breakfast');
  });

  it('load() no-ops if already loaded', () => {
    service.load();
    http.expectOne(`${BASE}/meal-pattern`).flush([]);
    service.load();
    http.expectNone(`${BASE}/meal-pattern`);
  });

  it('create() POSTs and appends to signal sorted by sort_order', () => {
    service['entriesSignal'].set([{ id: '2', name: 'Dinner', preferred_time: '18:00:00',
                                    tolerance_minutes: 60, sort_order: 3, user_id: '', day_type_id: '', created_at: '', updated_at: '' }]);
    service['requested'] = true;
    service.create({ name: 'Lunch', preferred_time: '12:00', sort_order: 2 }).subscribe();
    const req = http.expectOne(`${BASE}/meal-pattern`);
    req.flush({ id: '3', name: 'Lunch', preferred_time: '12:00:00',
                tolerance_minutes: 60, sort_order: 2, user_id: '', day_type_id: '', created_at: '', updated_at: '' });
    expect(service.entries()[0].name).toBe('Lunch');   // sort_order=2 before sort_order=3
    expect(service.entries()[1].name).toBe('Dinner');
  });

  it('update() PATCHes and replaces entry in signal', () => {
    service['entriesSignal'].set([{ id: '1', name: 'Breakfast', preferred_time: '07:00:00',
                                    tolerance_minutes: 60, sort_order: 1, user_id: '', day_type_id: '', created_at: '', updated_at: '' }]);
    service['requested'] = true;
    service.update('1', { preferred_time: '08:00' }).subscribe();
    const req = http.expectOne(`${BASE}/meal-pattern/1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ preferred_time: '08:00' });
    req.flush({ id: '1', name: 'Breakfast', preferred_time: '08:00:00',
                tolerance_minutes: 60, sort_order: 1, user_id: '', day_type_id: '', created_at: '', updated_at: '' });
    expect(service.entries()[0].preferred_time).toBe('08:00:00');
  });

  it('delete() DELETEs and removes from signal', () => {
    service['entriesSignal'].set([{ id: '1', name: 'Breakfast', preferred_time: '08:00:00',
                                    tolerance_minutes: 60, sort_order: 1, user_id: '', day_type_id: '', created_at: '', updated_at: '' }]);
    service['requested'] = true;
    service.delete('1').subscribe();
    http.expectOne(`${BASE}/meal-pattern/1`).flush(null, { status: 204, statusText: 'No Content' });
    expect(service.entries().length).toBe(0);
  });

  it('clear() resets signal and allows re-fetch', () => {
    service['requested'] = true;
    service.clear();
    expect(service.entries().length).toBe(0);
    service.load();
    http.expectOne(`${BASE}/meal-pattern`).flush([]);
  });

  it('load() resets loaded flag on error so retry is possible', () => {
    service.load();
    http.expectOne(`${BASE}/meal-pattern`).flush('error', { status: 500, statusText: 'Server Error' });
    service.load();
    http.expectOne(`${BASE}/meal-pattern`).flush([]);
    expect(service.entries().length).toBe(0);
  });

  it('loaded() is false before HTTP resolves', () => {
    service.load();
    expect(service.loaded()).toBeFalse();
    http.expectOne(`${BASE}/meal-pattern`).flush([]);
  });

  it('loaded() becomes true after HTTP resolves', () => {
    service.load();
    http.expectOne(`${BASE}/meal-pattern`).flush([]);
    expect(service.loaded()).toBeTrue();
  });

  it('loaded() resets to false after clear()', () => {
    service.load();
    http.expectOne(`${BASE}/meal-pattern`).flush([]);
    expect(service.loaded()).toBeTrue();
    service.clear();
    expect(service.loaded()).toBeFalse();
  });
});
