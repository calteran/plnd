import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { OAuthService } from 'angular-oauth2-oidc';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Handles the OIDC redirect after the authorization code flow completes.
 *
 * The OIDC library (angular-oauth2-oidc) exchanges the authorization code for
 * an ID token at the IdP's token endpoint. This component then sends that ID
 * token to the backend, which validates it via JWKS and issues a backend JWT.
 */
@Component({
  selector: 'app-auth-callback',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>Signing in…</p>`
})
export class AuthCallbackComponent implements OnInit {
  private readonly oauthService = inject(OAuthService);
  private readonly auth = inject(AuthService);

  ngOnInit(): void {
    // Complete the OIDC code exchange: the library reads the `code` query param,
    // sends it to the IdP's token endpoint, and stores the resulting ID token.
    this.oauthService.loadDiscoveryDocumentAndTryLogin().then(() => {
      const idToken = this.oauthService.getIdToken();
      if (!idToken) {
        // No ID token — abort and clear any partial state.
        this.auth.logout();
        return;
      }
      // Exchange the IdP ID token for a backend JWT via POST /auth/token.
      this.auth.exchangeToken().subscribe({
        next: backendToken => this.auth.handleCallback(backendToken),
        error: () => this.auth.logout(),
      });
    });
  }
}
