import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

describe('authGuard', () => {
  let authService: AuthService;

  const mockRoute = {} as ActivatedRouteSnapshot;
  const mockState = { url: '/dashboard' } as RouterStateSnapshot;

  function runGuard() {
    return TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule]
    });
    authService = TestBed.inject(AuthService);
    localStorage.clear();
  });

  it('should allow access when authenticated', () => {
    spyOn(authService, 'isAuthenticated').and.returnValue(true);
    expect(runGuard()).toBe(true);
  });

  it('should redirect to /login when not authenticated', () => {
    spyOn(authService, 'isAuthenticated').and.returnValue(false);
    const result = runGuard();
    expect(result).not.toBe(true);
  });
});
