import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { environment } from '../../../environments/environment';

describe('authInterceptor', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;

  const backendUrl = `${environment.api.baseUrl}/test`;
  const idpUrl = `${environment.oidc.issuerUrl}/.well-known/openid-configuration`;
  const thirdPartyUrl = 'https://api.example.com/data';

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
    http.get(backendUrl).subscribe();
    const req = httpMock.expectOne(backendUrl);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('attaches Bearer token for requests to the backend base URL', () => {
    localStorage.setItem('auth_token', 'my-jwt-token');
    http.get(backendUrl).subscribe();
    const req = httpMock.expectOne(backendUrl);
    expect(req.request.headers.get('Authorization')).toBe('Bearer my-jwt-token');
    req.flush({});
  });

  it('clones the request and does not mutate the original (header set exactly once)', () => {
    localStorage.setItem('auth_token', 'my-jwt-token');
    http.get(backendUrl).subscribe();
    const req = httpMock.expectOne(backendUrl);
    expect(req.request.headers.getAll('Authorization')?.length).toBe(1);
    req.flush({});
  });

  it('does NOT attach token for requests to the IdP', () => {
    localStorage.setItem('auth_token', 'my-jwt-token');
    http.get(idpUrl).subscribe();
    const req = httpMock.expectOne(idpUrl);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('does NOT attach token for requests to third-party URLs', () => {
    localStorage.setItem('auth_token', 'my-jwt-token');
    http.get(thirdPartyUrl).subscribe();
    const req = httpMock.expectOne(thirdPartyUrl);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });
});
