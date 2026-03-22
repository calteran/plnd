import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';
import { OAuthService } from 'angular-oauth2-oidc';
import { ConfigService } from './config.service';
import { UserService } from './user.service';
import { PreferencesService } from './preferences.service';
import { DietaryRestrictionsService } from './dietary-restrictions.service';
import { UserDishesService } from './user-dishes.service';
import { UserMealsService } from './user-meals.service';
import { UserIngredientPrefsService } from './user-ingredient-prefs.service';
import { TokenExchangeRequest, TokenExchangeResponse } from '../models/auth';

const TOKEN_KEY = 'auth_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly config = inject(ConfigService);
  private readonly http = inject(HttpClient);
  private readonly oauthService = inject(OAuthService);
  private readonly userService = inject(UserService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly dietaryRestrictionsService = inject(DietaryRestrictionsService);
  private readonly userDishesService = inject(UserDishesService);
  private readonly userMealsService = inject(UserMealsService);
  private readonly userIngredientPrefsService = inject(UserIngredientPrefsService);

  private readonly tokenSignal = signal<string | null>(
    localStorage.getItem(TOKEN_KEY)
  );

  /** True when the user has a stored backend JWT. */
  readonly isAuthenticated = computed(() => this.tokenSignal() !== null);

  constructor() {
    // Configure the OIDC library once at service construction. All components
    // share the same singleton OAuthService instance, so this runs once per app.
    const cfg = this.config.getConfig().oidc;
    this.oauthService.configure({
      issuer: cfg.issuerUrl,
      redirectUri: cfg.redirectUri,
      clientId: cfg.clientId,
      scope: cfg.scope,
      responseType: 'code',
      // The mock OAuth server omits some optional OIDC discovery fields;
      // disable strict validation to avoid false rejections.
      strictDiscoveryDocumentValidation: false,
    });
  }

  /**
   * Start the OIDC authorization code + PKCE flow.
   * The library handles state, nonce, and code_challenge automatically.
   */
  login(): void {
    this.oauthService.loadDiscoveryDocumentAndLogin();
  }

  /**
   * Exchange the IdP ID token (obtained by the OIDC library after the callback)
   * for a backend JWT. Called by AuthCallbackComponent after code exchange completes.
   */
  exchangeToken(): Observable<string> {
    const apiBase = this.config.getConfig().api.baseUrl;
    const body: TokenExchangeRequest = {
      id_token: this.oauthService.getIdToken(),
      provider: 'mock',
    };
    return this.http
      .post<TokenExchangeResponse>(`${apiBase}/auth/token`, body)
      .pipe(map(r => r.access_token));
  }

  /**
   * Store the backend JWT and navigate to the onboarding flow.
   * Called by AuthCallbackComponent after a successful token exchange.
   */
  handleCallback(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this.tokenSignal.set(token);
    this.router.navigate(['/onboarding']);
  }

  /**
   * Clear local auth state immediately (optimistic logout), then revoke the
   * session server-side as a fire-and-forget call.
   *
   * @param reason - Optional reason code passed as a query param to /login.
   *   Use 'session_expired' when the backend rejected a stale token so the
   *   login page can show an explanatory notice.
   */
  logout(reason?: string): void {
    // Clear local state synchronously so the UI responds immediately.
    localStorage.removeItem(TOKEN_KEY);
    this.tokenSignal.set(null);
    this.userService.clearUser();
    this.preferencesService.clearPreferences();
    this.dietaryRestrictionsService.clear();
    this.userDishesService.clear();
    this.userMealsService.clear();
    this.userIngredientPrefsService.clear();
    // logOut() clears OIDC library's stored tokens (id_token, access_token).
    this.oauthService.logOut(true); // true = do not redirect to IdP logout URL
    if (reason) {
      this.router.navigate(['/login'], { queryParams: { reason } });
    } else {
      this.router.navigate(['/login']);
    }

    // Revoke the server-side session (fire-and-forget — errors are swallowed).
    const apiBase = this.config.getConfig().api.baseUrl;
    this.http
      .post(`${apiBase}/auth/logout`, {})
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  getToken(): string | null {
    return this.tokenSignal();
  }
}
