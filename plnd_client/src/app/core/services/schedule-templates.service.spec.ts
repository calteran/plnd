import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ScheduleTemplatesService } from './schedule-templates.service';
import { ScheduleTemplate } from '../models/schedule-template';

const base: Omit<ScheduleTemplate, 'template_id' | 'title'> = {
  user_id: 'user-uuid',
  task_type: 'custom',
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

const MOCK_TEMPLATE_A: ScheduleTemplate = { ...base, template_id: 'tid-1', title: 'Morning walk' };
const MOCK_TEMPLATE_B: ScheduleTemplate = { ...base, template_id: 'tid-2', title: 'Evening stretch', recurrence: 'weekdays', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' };

describe('ScheduleTemplatesService', () => {
  let service: ScheduleTemplatesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(ScheduleTemplatesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('load() sets the signal from GET response', () => {
    expect(service.templates()).toBeNull();

    service.load();

    const req = httpMock.expectOne(r => r.url.endsWith('/schedule/templates') && r.method === 'GET');
    req.flush([MOCK_TEMPLATE_A, MOCK_TEMPLATE_B]);

    expect(service.templates()).toEqual([MOCK_TEMPLATE_A, MOCK_TEMPLATE_B]);
  });

  it('load() no-ops when already loaded', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_TEMPLATE_A]);

    service.load();
    httpMock.expectNone(r => r.url.endsWith('/schedule/templates'));

    expect(service.templates()).toEqual([MOCK_TEMPLATE_A]);
  });

  it('load() still fetches after create() pre-populates the signal', () => {
    service.create({ task_type: 'custom', title: 'Morning walk', recurrence: 'daily' }).subscribe();
    httpMock.expectOne(r => r.method === 'POST').flush(MOCK_TEMPLATE_A);

    // Signal is non-null now, but load() should still fetch (loaded flag is still false)
    service.load();
    const req = httpMock.expectOne(r => r.url.endsWith('/schedule/templates') && r.method === 'GET');
    req.flush([MOCK_TEMPLATE_A, MOCK_TEMPLATE_B]);

    expect(service.templates()).toEqual([MOCK_TEMPLATE_A, MOCK_TEMPLATE_B]);
  });

  it('clear() allows load() to fetch again', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_TEMPLATE_A]);

    service.clear();
    expect(service.templates()).toBeNull();

    service.load();
    httpMock.expectOne(r => r.url.endsWith('/schedule/templates') && r.method === 'GET').flush([MOCK_TEMPLATE_B]);
    expect(service.templates()).toEqual([MOCK_TEMPLATE_B]);
  });

  it('create() posts and appends item to signal', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_TEMPLATE_A]);

    let result: ScheduleTemplate | undefined;
    service.create({ task_type: 'custom', title: 'Evening stretch', recurrence: 'weekdays' }).subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/schedule/templates') && r.method === 'POST');
    req.flush(MOCK_TEMPLATE_B);

    expect(result).toEqual(MOCK_TEMPLATE_B);
    expect(service.templates()).toEqual([MOCK_TEMPLATE_A, MOCK_TEMPLATE_B]);
  });

  it('delete() removes item from signal', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_TEMPLATE_A, MOCK_TEMPLATE_B]);

    service.delete('tid-1').subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/schedule/templates/tid-1') && r.method === 'DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(service.templates()!.length).toBe(1);
    expect(service.templates()![0].template_id).toBe('tid-2');
  });

  it('clear() resets signal to null', () => {
    service.load();
    httpMock.expectOne(r => r.method === 'GET').flush([MOCK_TEMPLATE_A]);
    expect(service.templates()).not.toBeNull();

    service.clear();
    expect(service.templates()).toBeNull();
  });
});
