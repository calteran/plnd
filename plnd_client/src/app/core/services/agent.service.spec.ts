import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AgentService } from './agent.service';
import { ConfigService } from './config.service';
import { TaskEntryRequest, TaskEntryResponse } from '../models/agent';

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

    expect(errorCaught).toBeTrue();
  });

  it('returns a cold Observable (no request until subscribed)', () => {
    service.createTask({ input: 'test' });
    httpMock.expectNone('http://localhost:3000/agent/task');
  });
});
