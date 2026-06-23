import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AgentService } from './agent.service';
import { ConfigService } from './config.service';
import { TaskEntryRequest, TaskEntryResponse } from '../models/agent';
import { PlaceTasksRequest, PlaceTasksEntry } from '../models/week-plan';

const mockConfig = { api: { baseUrl: 'http://localhost:3000' } };

const mockResponse: TaskEntryResponse = {
  actions_taken: [{ type: 'task_created', task_id: 'abc-123' }],
  ui_signals: [],
  confirmation: 'Task added!',
};

describe('AgentService', () => {
  let service: AgentService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { getConfig: () => mockConfig } },
      ],
    });
    service = TestBed.inject(AgentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('POSTs to /agent/task with the request body', () => {
    const req: TaskEntryRequest = { input: 'buy groceries' };
    let result: TaskEntryResponse | undefined;

    service.createTask(req).subscribe((r: TaskEntryResponse) => (result = r));

    const http = httpMock.expectOne('http://localhost:3000/agent/task');
    expect(http.request.method).toBe('POST');
    expect(http.request.body).toEqual(req);
    http.flush(mockResponse);

    expect(result).toEqual(mockResponse);
  });

  it('includes context turns in the request body', () => {
    const req: TaskEntryRequest = {
      input: 'buy groceries',
      context: [
        {
          signals: [{ type: 'show_checkbox', field: 'urgent' }],
          answers: { urgent: true },
        },
      ],
    };

    service.createTask(req).subscribe();

    const http = httpMock.expectOne('http://localhost:3000/agent/task');
    expect(http.request.body).toEqual(req);
    http.flush(mockResponse);
  });

  it('propagates HTTP errors to the subscriber', () => {
    let errorCaught = false;

    service.createTask({ input: 'test' }).subscribe({
      error: () => (errorCaught = true),
    });

    httpMock
      .expectOne('http://localhost:3000/agent/task')
      .error(new ErrorEvent('Network error'));

    expect(errorCaught).toBe(true);
  });

  it('returns a cold Observable (no request until subscribed)', () => {
    service.createTask({ input: 'test' });
    httpMock.expectNone('http://localhost:3000/agent/task');
  });

  // ── placeTasks() ─────────────────────────────────────────────────────────────

  it('POSTs to /agent/place-tasks with the request body', () => {
    const req: PlaceTasksRequest = {
      task_names: ['Morning Walk'],
      routine_templates: [],
      plan_start: '2026-04-28',
      plan_end: '2026-04-30',
    };
    const mockEntries: PlaceTasksEntry[] = [{
      title: 'Morning Walk',
      scheduled_date: '2026-04-28',
      time_window_start: '08:00',
      duration_minutes: 30,
      energy_required: 'medium',
      task_type: 'exercise',
    }];
    let result: PlaceTasksEntry[] | undefined;

    service.placeTasks(req).subscribe((r: PlaceTasksEntry[]) => (result = r));

    const http = httpMock.expectOne('http://localhost:3000/agent/place-tasks');
    expect(http.request.method).toBe('POST');
    expect(http.request.body).toEqual(req);
    http.flush(mockEntries);

    expect(result).toEqual(mockEntries);
  });
});
