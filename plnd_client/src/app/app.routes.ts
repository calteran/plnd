import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { onboardingNotCompletedGuard, onboardingCompletedGuard } from './core/guards/onboarding.guard';

export const routes: Routes = [
  // Redirect root to dashboard (auth guard handles unauthenticated redirect to /login)
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },

  // Unauthenticated pages — wrapped in the auth layout shell
  {
    path: '',
    loadComponent: () =>
      import('./layouts/auth-layout/auth-layout').then(m => m.AuthLayoutComponent),
    children: [
      {
        path: 'login',
        loadComponent: () =>
          import('./features/auth/login/login').then(m => m.LoginComponent)
      },
      {
        path: 'auth/callback',
        loadComponent: () =>
          import('./features/auth/callback/callback').then(m => m.AuthCallbackComponent)
      }
    ]
  },

  // Onboarding wizard — self-contained, no layout shell
  {
    path: 'onboarding',
    canActivate: [authGuard, onboardingNotCompletedGuard],
    loadComponent: () =>
      import('./features/onboarding/onboarding').then(m => m.OnboardingComponent)
  },

  // Authenticated pages — wrapped in the main layout shell, guarded
  {
    path: '',
    loadComponent: () =>
      import('./layouts/main-layout/main-layout').then(m => m.MainLayoutComponent),
    canActivate: [authGuard, onboardingCompletedGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard').then(m => m.DashboardComponent)
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./features/user/profile/profile').then(m => m.ProfileComponent)
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings').then(m => m.SettingsComponent)
      },
      {
        path: 'dietary-restrictions',
        loadComponent: () =>
          import('./features/meals/dietary-restrictions/dietary-restrictions').then(m => m.DietaryRestrictionsComponent)
      }
    ]
  },

  // Fallback — redirect unknown paths to dashboard (guard will redirect to login if needed)
  { path: '**', redirectTo: '/dashboard' }
];
