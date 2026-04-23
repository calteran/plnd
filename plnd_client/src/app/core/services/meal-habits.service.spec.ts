import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MealHabitsService } from './meal-habits.service';
import { ConfigService } from './config.service';
import { MealHabitResponse, CreateMealHabitRequest } from '../models/meal-habit';

const mockConfig = { getConfig: () => ({ api: { baseUrl: 'http://api' } }) };

describe('MealHabitsService', () => {
  let service: MealHabitsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: mockConfig },
      ],
    });
    service = TestBed.inject(MealHabitsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('load() fetches /meal-habits and populates signal', () => {
    const habits: MealHabitResponse[] = [{
      id: 'h1', user_id: 'u1', meal_name: 'Oatmeal',
      slot: 'breakfast', recurrence_rule: 'FREQ=DAILY', created_at: '2026-01-01T00:00:00Z',
    }];
    service.load();
    http.expectOne('http://api/meal-habits').flush(habits);
    expect(service.habits()).toEqual(habits);
  });

  it('load() no-ops if already loaded', () => {
    service.load();
    http.expectOne('http://api/meal-habits').flush([]);
    service.load(); // second call
    http.expectNone('http://api/meal-habits');
  });

  it('create() POSTs and appends to signal without removing existing', () => {
    const existing: MealHabitResponse = {
      id: 'h1', user_id: 'u1', meal_name: 'Oatmeal',
      slot: 'breakfast', recurrence_rule: 'FREQ=DAILY', created_at: '2026-01-01T00:00:00Z',
    };
    service.load();
    http.expectOne('http://api/meal-habits').flush([existing]);

    const req: CreateMealHabitRequest = { meal_name: 'Eggs', slot: 'breakfast', recurrence_rule: 'FREQ=DAILY' };
    const created: MealHabitResponse = { id: 'h2', user_id: 'u1', ...req, created_at: '2026-01-01T00:00:00Z' };
    let result: MealHabitResponse | undefined;
    service.create(req).subscribe(r => result = r);
    http.expectOne('http://api/meal-habits').flush(created);
    expect(result).toEqual(created);
    expect(service.habits()).toContain(created);
    expect(service.habits()).toContain(existing); // original still present
  });

  it('delete() DELETEs and removes from signal', () => {
    const habit: MealHabitResponse = { id: 'h3', user_id: 'u1', meal_name: 'Yogurt',
      slot: 'lunch', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO', created_at: '2026-01-01T00:00:00Z' };
    service.load();
    http.expectOne('http://api/meal-habits').flush([habit]);
    service.delete('h3').subscribe();
    http.expectOne('http://api/meal-habits/h3').flush(null);
    expect(service.habits()).not.toContain(habit);
  });

  it('clear() resets signal to empty and allows re-fetch', () => {
    const habit: MealHabitResponse = {
      id: 'h5', user_id: 'u1', meal_name: 'Toast',
      slot: 'breakfast', recurrence_rule: 'FREQ=DAILY', created_at: '2026-01-01T00:00:00Z',
    };
    service.load();
    http.expectOne('http://api/meal-habits').flush([habit]);
    expect(service.habits().length).toBe(1); // data is present

    service.clear();
    expect(service.habits()).toEqual([]); // signal reset
    service.load(); // should fetch again after clear
    http.expectOne('http://api/meal-habits').flush([]);
    expect(service.habits()).toEqual([]);
  });
});
