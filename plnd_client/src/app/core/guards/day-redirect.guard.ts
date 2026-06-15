import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { todayIso, offsetIso } from '../services/schedule.service';
import { parseDateOnly } from '../utils/date-only';

export const todayRedirectGuard: CanActivateFn = () =>
  inject(Router).createUrlTree(['/day', todayIso()]);

export const yesterdayRedirectGuard: CanActivateFn = () =>
  inject(Router).createUrlTree(['/day', offsetIso(-1)]);

export const tomorrowRedirectGuard: CanActivateFn = () =>
  inject(Router).createUrlTree(['/day', offsetIso(1)]);

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = parseDateOnly(s);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export const validateDayDateGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const router = inject(Router);
  const date = route.params['date'] as string;
  if (date === 'today')     return router.createUrlTree(['/day', todayIso()]);
  if (date === 'yesterday') return router.createUrlTree(['/day', offsetIso(-1)]);
  if (date === 'tomorrow')  return router.createUrlTree(['/day', offsetIso(1)]);
  return isValidIsoDate(date) ? true : router.createUrlTree(['/not-found']);
};
