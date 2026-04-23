import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { OAuthService } from 'angular-oauth2-oidc';
import { AuthService } from './auth.service';
import { SessionStateService } from './session-state.service';

const API_BASE = 'http://localhost:3000';

function buildOAuthMock() {
  return jasmine.createSpyObj('OAuthService', [
    'configure',
    'loadDiscoveryDocumentAndLogin',
    'loadDiscoveryDocumentAndTryLogin',
    'getIdToken',
    'logOut',
  ]);
}

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let mockOauthService: jasmine.SpyObj<OAuthService>;

  beforeEach(() => {
    localStorage.clear();
    mockOauthService = buildOAuthMock();

    TestBed.configureTestingModule({
      providers: [
        { provide: OAuthService, useValue: mockOauthService },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Flush any outstanding fire-and-forget requests so verify() passes.
    httpMock.match(() => true).forEach(r => r.flush(null));
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('calls oauthService.configure() on construction with OIDC settings', () => {
    expect(mockOauthService.configure).toHaveBeenCalledWith(jasmine.objectContaining({
      issuer: jasmine.any(String),
      clientId: jasmine.any(String),
      responseType: 'code',
    }));
  });

  it('passes strictDiscoveryDocumentValidation from config to oauthService.configure()', () => {
    // The dev environment sets strictDiscoveryDocumentValidation: false for the mock IdP.
    expect(mockOauthService.configure).toHaveBeenCalledWith(jasmine.objectContaining({
      strictDiscoveryDocumentValidation: false,
    }));
  });

  it('should not be authenticated initially', () => {
    expect(service.isAuthenticated()).toBeFalse();
  });

  it('should be authenticated after handleCallback', () => {
    service.handleCallback('test-jwt-token');
    expect(service.isAuthenticated()).toBeTrue();
    expect(service.getToken()).toBe('test-jwt-token');
  });

  it('should clear token after logout', () => {
    service.handleCallback('test-jwt-token');
    service.logout();
    expect(service.isAuthenticated()).toBeFalse();
    expect(service.getToken()).toBeNull();
  });

  it('getToken() returns null initially', () => {
    expect(service.getToken()).toBeNull();
  });

  it('login() calls oauthService.loadDiscoveryDocumentAndLogin()', () => {
    service.login();
    expect(mockOauthService.loadDiscoveryDocumentAndLogin).toHaveBeenCalled();
  });

  it('exchangeToken() POSTs id_token to /auth/token and returns access_token', () => {
    mockOauthService.getIdToken.and.returnValue('id-token-value');

    let result: string | undefined;
    service.exchangeToken().subscribe(token => (result = token));

    const req = httpMock.expectOne(`${API_BASE}/auth/token`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.id_token).toBe('id-token-value');
    expect(req.request.body.provider).toBe('mock');
    req.flush({ access_token: 'backend-jwt', token_type: 'Bearer', expires_in: 86400 });

    expect(result).toBe('backend-jwt');
  });

  it('logout() fires POST to /auth/logout (fire-and-forget)', () => {
    service.handleCallback('test-jwt-token');
    service.logout();
    // State is cleared synchronously; the HTTP call is fire-and-forget.
    const req = httpMock.expectOne(`${API_BASE}/auth/logout`);
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('logout() calls oauthService.logOut()', () => {
    service.logout();
    expect(mockOauthService.logOut).toHaveBeenCalled();
  });

  it('logout() calls clearAll() on SessionStateService', () => {
    const sessionState = TestBed.inject(SessionStateService);
    spyOn(sessionState, 'clearAll');
    service.logout();
    expect(sessionState.clearAll).toHaveBeenCalled();
  });

  it('logout() with a reason navigates to /login with that reason as a query param', () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    service.logout('session_expired');
    expect(router.navigate).toHaveBeenCalledWith(
      ['/login'], { queryParams: { reason: 'session_expired' } }
    );
  });

  it('logout() without a reason navigates to /login without query params', () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    service.logout();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {});
  });

  describe('when localStorage already has a token on startup', () => {
    beforeEach(() => {
      TestBed.resetTestingModule();
      localStorage.setItem('auth_token', 'pre-existing-token');
      mockOauthService = buildOAuthMock();
      TestBed.configureTestingModule({
        providers: [
          { provide: OAuthService, useValue: mockOauthService },
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
        ]
      });
    });

    afterEach(() => { localStorage.clear(); });

    it('should be authenticated on construction', () => {
      const svc = TestBed.inject(AuthService);
      expect(svc.isAuthenticated()).toBeTrue();
      expect(svc.getToken()).toBe('pre-existing-token');
    });
  });
});
