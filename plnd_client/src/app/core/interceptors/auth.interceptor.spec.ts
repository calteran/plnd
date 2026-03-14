import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting()
      ]
    });
    httpMock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('passes request through without Authorization header when no token', () => {
    http.get('/test').subscribe();
    const req = httpMock.expectOne('/test');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('attaches Bearer token when token is present in localStorage', () => {
    localStorage.setItem('auth_token', 'my-jwt-token');
    http.get('/test').subscribe();
    const req = httpMock.expectOne('/test');
    expect(req.request.headers.get('Authorization')).toBe('Bearer my-jwt-token');
    req.flush({});
  });

  it('clones the request and does not mutate the original (header set exactly once)', () => {
    localStorage.setItem('auth_token', 'my-jwt-token');
    http.get('/test').subscribe();
    const req = httpMock.expectOne('/test');
    expect(req.request.headers.getAll('Authorization')?.length).toBe(1);
    req.flush({});
  });
});
