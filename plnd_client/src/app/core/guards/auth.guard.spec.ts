import { createSpyObj } from '../../../testing/spy';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { OAuthService } from 'angular-oauth2-oidc';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';

describe('authGuard', () => {
  let authService: AuthService;

  const mockRoute = {} as ActivatedRouteSnapshot;
  const mockState = { url: '/dashboard' } as RouterStateSnapshot;

  function runGuard() {
    return TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
  }

  beforeEach(() => {
    const oauthMock = createSpyObj(['configure', 'logOut', 'loadDiscoveryDocumentAndLogin', 'getIdToken']);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OAuthService, useValue: oauthMock }, provideRouter([])]
    });
    authService = TestBed.inject(AuthService);
    localStorage.clear();
  });

  it('should allow access when authenticated', () => {
    vi.spyOn(authService, 'isAuthenticated').mockReturnValue(true);
    expect(runGuard()).toBe(true);
  });

  it('should redirect to /login when not authenticated', () => {
    vi.spyOn(authService, 'isAuthenticated').mockReturnValue(false);
    const result = runGuard();
    expect(result).not.toBe(true);
  });

  it('redirect target is specifically /login (not another route)', () => {
    vi.spyOn(authService, 'isAuthenticated').mockReturnValue(false);
    const result = runGuard();
    expect((result as UrlTree).toString()).toBe('/login');
  });
});
