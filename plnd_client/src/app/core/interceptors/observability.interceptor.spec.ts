import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { observabilityInterceptor } from './observability.interceptor';

describe('observabilityInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([observabilityInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('attaches X-Request-ID header to every outbound request', () => {
    http.get('/api/test').subscribe();
    const req = httpTesting.expectOne('/api/test');
    expect(req.request.headers.has('X-Request-ID')).toBeTrue();
    req.flush({});
  });

  it('generates a different X-Request-ID for each request', () => {
    http.get('/api/a').subscribe();
    http.get('/api/b').subscribe();
    const [reqA, reqB] = httpTesting.match(() => true);
    const idA = reqA.request.headers.get('X-Request-ID');
    const idB = reqB.request.headers.get('X-Request-ID');
    expect(idA).not.toEqual(idB);
    reqA.flush({});
    reqB.flush({});
  });

  it('passes through successful responses unchanged', () => {
    let result: unknown;
    http.get('/api/test').subscribe(r => (result = r));
    httpTesting.expectOne('/api/test').flush({ ok: true });
    expect(result).toEqual({ ok: true });
  });

  it('calls fetch to report 4xx/5xx errors', () => {
    const fetchSpy = spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(new Response(null, { status: 204 }))
    );
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    http.get('/api/fail').subscribe({ error: () => {} });
    httpTesting.expectOne('/api/fail').flush(
      { message: 'Not Found' },
      { status: 404, statusText: 'Not Found' }
    );
    expect(fetchSpy).toHaveBeenCalledOnceWith(
      '/api/client_error',
      jasmine.objectContaining({ method: 'POST', keepalive: true })
    );
  });
});
