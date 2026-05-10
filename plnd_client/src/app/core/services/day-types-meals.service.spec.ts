import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DayTypesMealsService } from './day-types-meals.service';
import { DayTypesService } from './day-types.service';
import { MealPatternEntry } from '../models/meal-pattern';
import { DayTypeResponse } from '../models/day-type';

const WORKDAY_MEALS: MealPatternEntry[] = [
  { id: 'w1', name: 'breakfast', preferred_time: '08:00:00', tolerance_minutes: 30, sort_order: 1, user_id: 'u1', day_type_id: 'dt-work', created_at: '', updated_at: '' },
  { id: 'w2', name: 'lunch',     preferred_time: '12:00:00', tolerance_minutes: 60, sort_order: 2, user_id: 'u1', day_type_id: 'dt-work', created_at: '', updated_at: '' },
  { id: 'w3', name: 'dinner',    preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 3, user_id: 'u1', day_type_id: 'dt-work', created_at: '', updated_at: '' },
];

const WEEKEND_MEALS: MealPatternEntry[] = [
  { id: 'e1', name: 'brunch',  preferred_time: '10:00:00', tolerance_minutes: 60, sort_order: 1, user_id: 'u1', day_type_id: 'dt-wknd', created_at: '', updated_at: '' },
  { id: 'e2', name: 'dinner',  preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 2, user_id: 'u1', day_type_id: 'dt-wknd', created_at: '', updated_at: '' },
];

// bitmask: Mon-Fri = bits 1-5 = 62; Sat-Sun = bits 0,6 = 65
const DAY_TYPES: DayTypeResponse[] = [
  { id: 'dt-work', user_id: 'u1', name: 'Workday', days_bitmask: 62,
    wake_time: '07:00:00', sleep_time: '23:00:00',
    is_default: false, is_cycle: false, cycle_length: null, anchor_date: null, created_at: '' },
  { id: 'dt-wknd', user_id: 'u1', name: 'Weekend', days_bitmask: 65,
    wake_time: '08:00:00', sleep_time: '23:00:00',
    is_default: true, is_cycle: false, cycle_length: null, anchor_date: null, created_at: '' },
];

describe('DayTypesMealsService', () => {
  let service: DayTypesMealsService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        DayTypesService,
        DayTypesMealsService,
      ],
    }).compileComponents();
    service = TestBed.inject(DayTypesMealsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('load()', () => {
    it('fetches day types then each type\'s meals, sets loaded=true', () => {
      expect(service.loaded()).toBeFalse();
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals')).flush(DAY_TYPES);
      httpMock.expectOne(r => r.url.includes('/day-types/dt-work/meals')).flush(WORKDAY_MEALS);
      httpMock.expectOne(r => r.url.includes('/day-types/dt-wknd/meals')).flush(WEEKEND_MEALS);
      expect(service.loaded()).toBeTrue();
    });

    it('is idempotent — second call fires no HTTP requests', () => {
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals')).flush([]);
      service.load();
      httpMock.expectNone(() => true);
    });

    it('sets loaded=true even when day types list is empty', () => {
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals')).flush([]);
      expect(service.loaded()).toBeTrue();
    });

    it('resets requested on error so a retry fires a new HTTP request', () => {
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals'))
        .flush('error', { status: 500, statusText: 'Server Error' });
      expect(service.loaded()).toBeFalse();
      // After error, a second load() should fire a new HTTP request
      service.load();
      const req = httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals'));
      req.flush([]);
    });

    it('sets loadError=true when HTTP request fails', () => {
      expect(service.loadError()).toBeFalse();
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals'))
        .flush('error', { status: 401, statusText: 'Unauthorized' });
      expect(service.loadError()).toBeTrue();
    });

    it('loadError starts false and stays false on success', () => {
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals')).flush([]);
      expect(service.loadError()).toBeFalse();
    });

    it('loadError resets to false when load() is retried after an error', () => {
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals'))
        .flush('error', { status: 500, statusText: 'Server Error' });
      expect(service.loadError()).toBeTrue();
      // Retry: requested was reset on error, so a second load() fires
      service.load();
      expect(service.loadError()).toBeFalse(); // cleared at start of retry
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals')).flush([]);
    });
  });

  describe('mealsForDate()', () => {
    function loadFull() {
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals')).flush(DAY_TYPES);
      httpMock.expectOne(r => r.url.includes('/dt-work/meals')).flush(WORKDAY_MEALS);
      httpMock.expectOne(r => r.url.includes('/dt-wknd/meals')).flush(WEEKEND_MEALS);
    }

    it('returns workday meals for a Tuesday (2026-03-24)', () => {
      loadFull();
      const meals = service.mealsForDate('2026-03-24'); // Tuesday
      expect(meals.map(m => m.name)).toEqual(['breakfast', 'lunch', 'dinner']);
    });

    it('returns weekend meals for a Saturday (2026-03-28)', () => {
      loadFull();
      const meals = service.mealsForDate('2026-03-28'); // Saturday
      expect(meals.map(m => m.name)).toEqual(['brunch', 'dinner']);
    });

    it('falls back to default day type when no non-default type matches', () => {
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals')).flush([
        { id: 'dt-def', user_id: 'u1', name: 'Default', days_bitmask: 0,
          wake_time: '07:00:00', sleep_time: '23:00:00',
          is_default: true, is_cycle: false, cycle_length: null, anchor_date: null, created_at: '' },
      ]);
      httpMock.expectOne(r => r.url.includes('/dt-def/meals')).flush(WORKDAY_MEALS);
      expect(service.mealsForDate('2026-03-24').length).toBe(3);
    });

    it('returns [] when no day types are loaded', () => {
      expect(service.mealsForDate('2026-03-24')).toEqual([]);
    });

    it('uses UTC day-of-week — is not fooled when getDay() returns the wrong weekday', () => {
      loadFull();
      // Simulate a timezone where local noon on a Saturday reads as Tuesday.
      // If the service calls getDay(), it gets 2 (Tue) → matches Workday (bitmask 62) → wrong meals.
      // After fix: service delegates to the utility which calls getUTCDay(), unaffected by this spy.
      const getDay = spyOn(Date.prototype, 'getDay').and.returnValue(2); // fake Tuesday
      const meals = service.mealsForDate('2026-03-28'); // actual Saturday UTC
      expect(meals.map(m => m.name)).toEqual(['brunch', 'dinner']); // Saturday = Weekend meals
      getDay.and.callThrough(); // restore
    });
  });

  describe('allEntries()', () => {
    it('returns union of all slot names across all day types, sorted by sort_order', () => {
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals')).flush(DAY_TYPES);
      httpMock.expectOne(r => r.url.includes('/dt-work/meals')).flush(WORKDAY_MEALS);
      httpMock.expectOne(r => r.url.includes('/dt-wknd/meals')).flush(WEEKEND_MEALS);
      const names = service.allEntries().map(e => e.name);
      expect(names).toContain('breakfast');
      expect(names).toContain('lunch');
      expect(names).toContain('dinner');
      expect(names).toContain('brunch');
      expect(names.length).toBe(4);
    });

    it('returns [] before load is called', () => {
      expect(service.allEntries()).toEqual([]);
    });
  });

  describe('clear()', () => {
    it('resets signals and allows reload', () => {
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals')).flush([]);
      expect(service.loaded()).toBeTrue();
      service.clear();
      expect(service.loaded()).toBeFalse();
      expect(service.allEntries()).toEqual([]);
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals')).flush([]);
    });

    it('resets loadError on clear', () => {
      service.load();
      httpMock.expectOne(r => r.url.includes('/day-types') && !r.url.includes('/meals'))
        .flush('error', { status: 500, statusText: 'Server Error' });
      expect(service.loadError()).toBeTrue();
      service.clear();
      expect(service.loadError()).toBeFalse();
    });
  });
});
