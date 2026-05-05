import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { RoutinesService } from './routines.service';
import { Routine } from '../models/routine';

const base: Omit<Routine, 'routine_id' | 'title'> = {
  user_id: 'user-uuid',
  task_type: 'general',
  recurrence: 'daily',
  recurrence_rule: 'FREQ=DAILY',
  time_window_start: null,
  time_window_end: null,
  duration_minutes: null,
  energy_required: 'medium',
  is_milepost: false,
  task_ref_id: null,
  task_ref_type: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
};

const MOCK_ROUTINE_A: Routine = { ...base, routine_id: 'tid-1', title: 'Morning walk' };
const MOCK_ROUTINE_B: Routine = { ...base, routine_id: 'tid-2', title: 'Evening stretch', recurrence: 'weekdays', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' };

describe('RoutinesService', () => {
  let service: RoutinesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(RoutinesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('load() sets the signal from GET response', () => {
    expect(service.routines()).toBeNull();

    service.load();

    const req = httpMock.expectOne(r => r.url.endsWith('/routines') && r.method === 'GET');
    req.flush([MOCK_ROUTINE_A, MOCK_ROUTINE_B]);

    expect(service.routines()).toEqual([MOCK_ROUTINE_A, MOCK_ROUTINE_B]);
  });

  it('load() no-ops when already loaded', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ROUTINE_A]);

    service.load();
    httpMock.expectNone(r => r.url.endsWith('/routines'));

    expect(service.routines()).toEqual([MOCK_ROUTINE_A]);
  });

  it('load() still fetches after create() pre-populates the signal', () => {
    service.create({ task_type: 'general', title: 'Morning walk', recurrence: 'daily' }).subscribe();
    httpMock.expectOne(r => r.method === 'POST').flush(MOCK_ROUTINE_A);

    // Signal is non-null now, but load() should still fetch (loaded flag is still false)
    service.load();
    const req = httpMock.expectOne(r => r.url.endsWith('/routines') && r.method === 'GET');
    req.flush([MOCK_ROUTINE_A, MOCK_ROUTINE_B]);

    expect(service.routines()).toEqual([MOCK_ROUTINE_A, MOCK_ROUTINE_B]);
  });

  it('clear() allows load() to fetch again', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ROUTINE_A]);

    service.clear();
    expect(service.routines()).toBeNull();

    service.load();
    httpMock.expectOne(r => r.url.endsWith('/routines') && r.method === 'GET').flush([MOCK_ROUTINE_B]);
    expect(service.routines()).toEqual([MOCK_ROUTINE_B]);
  });

  it('create() posts and appends item to signal', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ROUTINE_A]);

    let result: Routine | undefined;
    service.create({ task_type: 'general', title: 'Evening stretch', recurrence: 'weekdays' }).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/routines') && r.method === 'POST');
    req.flush(MOCK_ROUTINE_B);

    expect(result).toEqual(MOCK_ROUTINE_B);
    expect(service.routines()).toEqual([MOCK_ROUTINE_A, MOCK_ROUTINE_B]);
  });

  it('delete() removes item from signal', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ROUTINE_A, MOCK_ROUTINE_B]);

    service.delete('tid-1').subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/routines/tid-1') && r.method === 'DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(service.routines()!.length).toBe(1);
    expect(service.routines()![0].routine_id).toBe('tid-2');
  });

  it('clear() resets signal to null', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_ROUTINE_A]);
    expect(service.routines()).not.toBeNull();

    service.clear();
    expect(service.routines()).toBeNull();
  });
});
