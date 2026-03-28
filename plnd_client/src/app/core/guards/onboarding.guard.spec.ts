import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, isObservable } from 'rxjs';
import { onboardingNotCompletedGuard, onboardingCompletedGuard } from './onboarding.guard';
import { UserService } from '../services/user.service';
import { User } from '../models/user';

interface UserServicePrivate { userSignal: { set: (v: User) => void } }

const BASE_USER: User = {
  user_id: 'test-uuid',
  email: 'test@example.com',
  display_name: null,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: false
};

const mockRoute = {} as ActivatedRouteSnapshot;
const mockState = { url: '/dashboard' } as RouterStateSnapshot;

function setUser(userService: UserService, user: User): void {
  (userService as unknown as UserServicePrivate).userSignal.set(user);
}

async function resolveGuard(fn: () => unknown): Promise<boolean | UrlTree> {
  const result = fn();
  if (isObservable(result)) {
    return firstValueFrom(result as Parameters<typeof firstValueFrom>[0]) as Promise<boolean | UrlTree>;
  }
  return result as boolean | UrlTree;
}

describe('onboardingNotCompletedGuard', () => {
  let userService: UserService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule]
    });
    userService = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => httpMock.verify());

  it('allows access when user signal has onboarding_completed: false', async () => {
    setUser(userService, { ...BASE_USER, onboarding_completed: false });

    const result = await TestBed.runInInjectionContext(() =>
      resolveGuard(() => onboardingNotCompletedGuard(mockRoute, mockState))
    );
    expect(result).toBe(true);
  });

  it('redirects to /today when onboarding_completed: true', async () => {
    setUser(userService, { ...BASE_USER, onboarding_completed: true });

    const result = await TestBed.runInInjectionContext(() =>
      resolveGuard(() => onboardingNotCompletedGuard(mockRoute, mockState))
    );
    expect(result instanceof UrlTree).toBeTrue();
    expect((result as UrlTree).toString()).toBe('/today');
  });

  it('fetches user when signal is null and allows when not completed', async () => {
    const resultPromise = TestBed.runInInjectionContext(() =>
      resolveGuard(() => onboardingNotCompletedGuard(mockRoute, mockState))
    );

    httpMock
      .expectOne(r => r.url.endsWith('/users/me') && r.method === 'GET')
      .flush({ ...BASE_USER, onboarding_completed: false });

    const result = await resultPromise;
    expect(result).toBe(true);
  });
});

describe('onboardingCompletedGuard', () => {
  let userService: UserService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule]
    });
    userService = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => httpMock.verify());

  it('allows access when onboarding_completed: true', async () => {
    setUser(userService, { ...BASE_USER, onboarding_completed: true });

    const result = await TestBed.runInInjectionContext(() =>
      resolveGuard(() => onboardingCompletedGuard(mockRoute, mockState))
    );
    expect(result).toBe(true);
  });

  it('redirects to /onboarding when onboarding_completed: false', async () => {
    setUser(userService, { ...BASE_USER, onboarding_completed: false });

    const result = await TestBed.runInInjectionContext(() =>
      resolveGuard(() => onboardingCompletedGuard(mockRoute, mockState))
    );
    expect(result instanceof UrlTree).toBeTrue();
    expect((result as UrlTree).toString()).toBe('/onboarding');
  });

  it('fetches user when signal is null and redirects when not completed', async () => {
    const resultPromise = TestBed.runInInjectionContext(() =>
      resolveGuard(() => onboardingCompletedGuard(mockRoute, mockState))
    );

    httpMock
      .expectOne(r => r.url.endsWith('/users/me') && r.method === 'GET')
      .flush({ ...BASE_USER, onboarding_completed: false });

    const result = await resultPromise;
    expect(result instanceof UrlTree).toBeTrue();
    expect((result as UrlTree).toString()).toBe('/onboarding');
  });
});
