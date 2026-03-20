import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { todayIso, offsetIso } from '../services/schedule.service';

export const todayRedirectGuard: CanActivateFn = () =>
  inject(Router).createUrlTree(['/day', todayIso()]);

export const yesterdayRedirectGuard: CanActivateFn = () =>
  inject(Router).createUrlTree(['/day', offsetIso(-1)]);

export const tomorrowRedirectGuard: CanActivateFn = () =>
  inject(Router).createUrlTree(['/day', offsetIso(1)]);
