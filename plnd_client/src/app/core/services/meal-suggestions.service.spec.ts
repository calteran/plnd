import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MealSuggestionsService } from './meal-suggestions.service';
import { ConfigService } from './config.service';

const MOCK_CONFIG = { api: { baseUrl: 'http://localhost:3000' } };
const MOCK_SUGGESTIONS = [
  { id: 'id-1', name: 'Oatmeal', suggestion_type: 'meal' },
  { id: 'id-2', name: 'Scrambled Eggs', suggestion_type: 'dish' },
];

describe('MealSuggestionsService', () => {
  let svc: MealSuggestionsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { getConfig: () => MOCK_CONFIG } as unknown as ConfigService },
      ],
    });
    svc = TestBed.inject(MealSuggestionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('suggestions() returns [] before any load', () => {
    expect(svc.suggestions('2026-04-02', 'breakfast')).toEqual([]);
  });

  it('load() fires GET /my/meal-suggestions with date and slot params', () => {
    svc.load('2026-04-02', 'breakfast');

    const req = httpMock.expectOne(r => r.url.includes('/my/meal-suggestions'));
    expect(req.request.params.get('date')).toBe('2026-04-02');
    expect(req.request.params.get('slot')).toBe('breakfast');
    req.flush(MOCK_SUGGESTIONS);
  });

  it('suggestions() returns API results after successful load', () => {
    svc.load('2026-04-02', 'breakfast');
    httpMock.expectOne(r => r.url.includes('/my/meal-suggestions')).flush(MOCK_SUGGESTIONS);
    expect(svc.suggestions('2026-04-02', 'breakfast')).toEqual(MOCK_SUGGESTIONS);
  });

  it('load() is idempotent — does not duplicate requests for same key', () => {
    svc.load('2026-04-02', 'breakfast');
    httpMock.expectOne(r => r.url.includes('/my/meal-suggestions')).flush(MOCK_SUGGESTIONS);

    svc.load('2026-04-02', 'breakfast'); // second call — no new request
    httpMock.expectNone(r => r.url.includes('/my/meal-suggestions'));
  });

  it('load() does not duplicate in-flight requests', () => {
    svc.load('2026-04-02', 'breakfast');
    svc.load('2026-04-02', 'breakfast'); // second call while in-flight
    // httpMock.expectOne asserts exactly one request was made
    httpMock.expectOne(r => r.url.includes('/my/meal-suggestions')).flush(MOCK_SUGGESTIONS);
  });

  it('suggestions() returns [] and does not throw on HTTP error', () => {
    svc.load('2026-04-02', 'breakfast');
    httpMock.expectOne(r => r.url.includes('/my/meal-suggestions'))
      .flush('error', { status: 500, statusText: 'Server Error' });
    expect(svc.suggestions('2026-04-02', 'breakfast')).toEqual([]);
  });

  describe('ensureLoaded()', () => {
    it('fires GET /my/meal-suggestions and resolves with the suggestions', done => {
      svc.ensureLoaded('2026-04-02', 'breakfast').subscribe(result => {
        expect(result).toEqual(MOCK_SUGGESTIONS);
        done();
      });
      httpMock.expectOne(r => r.url.includes('/my/meal-suggestions')).flush(MOCK_SUGGESTIONS);
    });

    it('also populates suggestions() after it resolves', done => {
      svc.ensureLoaded('2026-04-02', 'breakfast').subscribe(() => {
        expect(svc.suggestions('2026-04-02', 'breakfast')).toEqual(MOCK_SUGGESTIONS);
        done();
      });
      httpMock.expectOne(r => r.url.includes('/my/meal-suggestions')).flush(MOCK_SUGGESTIONS);
    });

    it('replays to a late subscriber without firing a second HTTP request', done => {
      // First subscriber triggers load
      svc.ensureLoaded('2026-04-02', 'breakfast').subscribe();
      httpMock.expectOne(r => r.url.includes('/my/meal-suggestions')).flush(MOCK_SUGGESTIONS);

      // Second subscriber (after load complete) gets cached value, no new HTTP request
      svc.ensureLoaded('2026-04-02', 'breakfast').subscribe(result => {
        expect(result).toEqual(MOCK_SUGGESTIONS);
        httpMock.expectNone(r => r.url.includes('/my/meal-suggestions'));
        done();
      });
    });

    it('resolves with [] and does not throw on HTTP error', done => {
      svc.ensureLoaded('2026-04-02', 'dinner').subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
      httpMock.expectOne(r => r.url.includes('/my/meal-suggestions'))
        .flush('error', { status: 500, statusText: 'Server Error' });
    });
  });
});
