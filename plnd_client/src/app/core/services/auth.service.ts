import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ConfigService } from './config.service';
import { UserService } from './user.service';
import { PreferencesService } from './preferences.service';
import { DietaryRestrictionsService } from './dietary-restrictions.service';

const TOKEN_KEY = 'auth_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly config = inject(ConfigService);
  private readonly userService = inject(UserService);
  private readonly preferencesService = inject(PreferencesService);

  private readonly dietaryRestrictionsService = inject(DietaryRestrictionsService);

  private readonly tokenSignal = signal<string | null>(
    localStorage.getItem(TOKEN_KEY)
  );

  /** True when the user has a stored token */
  readonly isAuthenticated = computed(() => this.tokenSignal() !== null);

  /**
   * Redirect the browser to the backend OAuth authorize endpoint, which
   * will in turn redirect to the mock OAuth server.
   */
  login(): void {
    const apiBase = this.config.getConfig().api.baseUrl;
    window.location.href = `${apiBase}/auth/oauth/mock/authorize`;
  }

  /**
   * Store the JWT received from the OAuth callback and navigate to the dashboard.
   */
  handleCallback(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this.tokenSignal.set(token);
    this.router.navigate(['/dashboard']);
  }

  /** Remove the stored token and send the user back to login. */
  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.tokenSignal.set(null);
    this.userService.clearUser();
    this.preferencesService.clearPreferences();
    this.dietaryRestrictionsService.clear();
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return this.tokenSignal();
  }
}
