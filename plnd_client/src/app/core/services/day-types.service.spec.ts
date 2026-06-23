import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { DayTypesService, bitmaskToDays, daysToBitmask } from './day-types.service';
import { DayTypeResponse, CreateDayTypeRequest } from '../models/day-type';
import { MealPatternEntry, CreateMealPatternEntryRequest, UpdateMealPatternEntryRequest } from '../models/meal-pattern';
import { ConfigService } from './config.service';

const MOCK_CONFIG = { api: { baseUrl: 'http://localhost:3000' } };

const MOCK_TYPE_A: DayTypeResponse = {
  id: 'type-uuid-1',
  user_id: 'user-uuid',
  name: 'Weekday Schedule',
  days_bitmask: 62,
  wake_time: '07:00:00',
  sleep_time: '22:00:00',
  is_cycle: false,
  cycle_length: null,
  anchor_date: null,
  cycle_bitmask: 0,
  created_at: '2026-01-01T00:00:00Z'
};

const MOCK_TYPE_B: DayTypeResponse = {
  id: 'type-uuid-2',
  user_id: 'user-uuid',
  name: 'Weekend Schedule',
  days_bitmask: 65,
  wake_time: '09:00:00',
  sleep_time: '23:00:00',
  is_cycle: false,
  cycle_length: null,
  anchor_date: null,
  cycle_bitmask: 0,
  created_at: '2026-01-02T00:00:00Z'
};

const CREATE_REQ: CreateDayTypeRequest = {
  name: 'Weekday Schedule',
  days_bitmask: 62,
  wake_time: '07:00',
  sleep_time: '22:00',
  is_cycle: false,
  cycle_length: null,
  anchor_date: null
};

describe('DayTypesService', () => {
  let service: DayTypesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { getConfig: () => MOCK_CONFIG } },
      ],
    });
    service = TestBed.inject(DayTypesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('list() makes GET request to correct URL and returns response', () => {
    let result: DayTypeResponse[] | undefined;
    service.list().subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url === 'http://localhost:3000/day-types' && r.method === 'GET');
    req.flush([MOCK_TYPE_A, MOCK_TYPE_B]);

    expect(result).toEqual([MOCK_TYPE_A, MOCK_TYPE_B]);
  });

  it('create() makes POST request with body and returns response', () => {
    let result: DayTypeResponse | undefined;
    service.create(CREATE_REQ).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url === 'http://localhost:3000/day-types' && r.method === 'POST');
    expect(req.request.body).toEqual(CREATE_REQ);
    req.flush(MOCK_TYPE_A);

    expect(result).toEqual(MOCK_TYPE_A);
  });

  it('update() makes PUT request to correct URL with body and returns response', () => {
    let result: DayTypeResponse | undefined;
    service.update('type-uuid-1', CREATE_REQ).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url === 'http://localhost:3000/day-types/type-uuid-1' && r.method === 'PUT');
    expect(req.request.body).toEqual(CREATE_REQ);
    req.flush(MOCK_TYPE_A);

    expect(result).toEqual(MOCK_TYPE_A);
  });

  it('setDefault() makes PATCH request to correct URL and returns response', () => {
    let result: DayTypeResponse | undefined;
    service.setDefault('type-uuid-1').subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url === 'http://localhost:3000/day-types/type-uuid-1/default' && r.method === 'PATCH');
    req.flush(MOCK_TYPE_A);

    expect(result).toEqual(MOCK_TYPE_A);
  });

  it('delete() makes DELETE request to correct URL and returns void', () => {
    let completed = false;
    service.delete('type-uuid-1').subscribe(() => (completed = true));

    const req = httpMock.expectOne(r => r.url === 'http://localhost:3000/day-types/type-uuid-1' && r.method === 'DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(completed).toBe(true);
  });

  describe('listMeals', () => {
    it('GET /day-types/{id}/meals', () => {
      const mockMeals: MealPatternEntry[] = [{
        id: 'm1', day_type_id: 'dt1', user_id: 'u1',
        name: 'Breakfast', preferred_time: '08:00:00',
        tolerance_minutes: 30, sort_order: 0,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      }];
      let result: MealPatternEntry[] | undefined;
      service.listMeals('dt1').subscribe(m => (result = m));
      const req = httpMock.expectOne(r => r.url.endsWith('/day-types/dt1/meals') && r.method === 'GET');
      req.flush(mockMeals);
      expect(result).toEqual(mockMeals);
    });
  });

  describe('createMeal', () => {
    it('POST /day-types/{id}/meals', () => {
      const body: CreateMealPatternEntryRequest = { name: 'Lunch', preferred_time: '12:00', sort_order: 1 };
      const mockMeal: MealPatternEntry = {
        id: 'm2', day_type_id: 'dt1', user_id: 'u1',
        name: 'Lunch', preferred_time: '12:00:00',
        tolerance_minutes: 30, sort_order: 1,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      };
      let result: MealPatternEntry | undefined;
      service.createMeal('dt1', body).subscribe(m => (result = m));
      const req = httpMock.expectOne(r => r.url.endsWith('/day-types/dt1/meals') && r.method === 'POST');
      expect(req.request.body).toEqual(body);
      req.flush(mockMeal);
      expect(result).toEqual(mockMeal);
    });
  });

  describe('updateMeal', () => {
    it('PATCH /day-types/{id}/meals/{mealId}', () => {
      const body: UpdateMealPatternEntryRequest = { preferred_time: '13:00' };
      let result: MealPatternEntry | undefined;
      service.updateMeal('dt1', 'm2', body).subscribe(m => (result = m));
      const req = httpMock.expectOne(r => r.url.endsWith('/day-types/dt1/meals/m2') && r.method === 'PATCH');
      expect(req.request.body).toEqual(body);
      req.flush({ id: 'm2', day_type_id: 'dt1', user_id: 'u1', name: 'Lunch', preferred_time: '13:00:00', tolerance_minutes: 30, sort_order: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
      expect(result?.preferred_time).toBe('13:00:00');
    });
  });

  describe('deleteMeal', () => {
    it('DELETE /day-types/{id}/meals/{mealId}', () => {
      let completed = false;
      service.deleteMeal('dt1', 'm1').subscribe({ complete: () => (completed = true) });
      const req = httpMock.expectOne(r => r.url.endsWith('/day-types/dt1/meals/m1') && r.method === 'DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
      expect(completed).toBe(true);
    });
  });
});

describe('bitmaskToDays', () => {
  it('converts 62 (Mon–Fri) to [1,2,3,4,5]', () => {
    expect(bitmaskToDays(62)).toEqual([1, 2, 3, 4, 5]);
  });

  it('converts 65 (Sun+Sat) to [0,6]', () => {
    expect(bitmaskToDays(65)).toEqual([0, 6]);
  });

  it('converts 0 to []', () => {
    expect(bitmaskToDays(0)).toEqual([]);
  });

  it('converts 127 (all days) to [0,1,2,3,4,5,6]', () => {
    expect(bitmaskToDays(127)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('daysToBitmask', () => {
  it('converts [1,2,3,4,5] (Mon–Fri) to 62', () => {
    expect(daysToBitmask([1, 2, 3, 4, 5])).toBe(62);
  });

  it('converts [0,6] (Sun+Sat) to 65', () => {
    expect(daysToBitmask([0, 6])).toBe(65);
  });

  it('converts [] to 0', () => {
    expect(daysToBitmask([])).toBe(0);
  });

  it('round-trips: daysToBitmask(bitmaskToDays(n)) === n for several values', () => {
    for (const n of [0, 1, 62, 65, 127, 42, 96]) {
      expect(daysToBitmask(bitmaskToDays(n))).toBe(n);
    }
  });
});
