import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authErrorInterceptor } from './auth-error.interceptor';
import { AuthService } from '../services/auth.service';

describe('authErrorInterceptor', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;
  let authService: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    authService = jasmine.createSpyObj('AuthService', ['logout']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService }
      ]
    });
    httpMock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('does not call logout on a successful 2xx response', () => {
    http.get('/api/test').subscribe();
    httpMock.expectOne('/api/test').flush({});
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('does not call logout on a 404 error', () => {
    http.get('/api/test').subscribe({ error: () => {} });
    httpMock.expectOne('/api/test').flush({}, { status: 404, statusText: 'Not Found' });
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('does not call logout on a 500 error', () => {
    http.get('/api/test').subscribe({ error: () => {} });
    httpMock.expectOne('/api/test').flush({}, { status: 500, statusText: 'Internal Server Error' });
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('calls logout with session_expired on a 401 from a backend URL', () => {
    http.get('/api/test').subscribe({ error: () => {} });
    httpMock.expectOne('/api/test').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(authService.logout).toHaveBeenCalledWith('session_expired');
  });

  it('does not call logout on a 401 from the OIDC issuer URL', () => {
    const oidcUrl = 'http://localhost:8080/plnd-dev/token';
    http.get(oidcUrl).subscribe({ error: () => {} });
    httpMock.expectOne(oidcUrl).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('re-throws the error so downstream handlers still receive it', () => {
    let caught: unknown;
    http.get('/api/test').subscribe({ error: (e: unknown) => { caught = e; } });
    httpMock.expectOne('/api/test').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(caught).toBeTruthy();
  });
});
