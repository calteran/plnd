import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { UserService } from '../services/user.service';
import { User } from '../models/user';

/**
 * Returns an observable of the current user.
 * Uses the cached signal value if available (synchronous fast path),
 * otherwise fetches once from the API.
 */
function resolveUser(userService: UserService): Observable<User | null> {
  const current = userService.user();
  if (current !== null) return of(current);
  return userService.fetchUser().pipe(
    take(1),
    map(user => user ?? null)
  );
}

/**
 * Guard for /onboarding — allows access only when onboarding is NOT yet complete.
 * Already-onboarded users are redirected to /dashboard.
 */
export const onboardingNotCompletedGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);
  return resolveUser(userService).pipe(
    map(user => {
      if (!user) return router.createUrlTree(['/login']);
      if (user.onboarding_completed) return router.createUrlTree(['/dashboard']);
      return true;
    })
  );
};

/**
 * Guard for authenticated app routes — redirects to /onboarding when onboarding
 * has not yet been completed. Runs after authGuard, so a valid token is guaranteed.
 */
export const onboardingCompletedGuard: CanActivateFn = () => {
  const userService = inject(UserService);
  const router = inject(Router);
  return resolveUser(userService).pipe(
    map(user => {
      if (!user) return router.createUrlTree(['/login']);
      if (!user.onboarding_completed) return router.createUrlTree(['/onboarding']);
      return true;
    })
  );
};
