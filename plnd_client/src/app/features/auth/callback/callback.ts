import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Handles the OAuth redirect from the backend. The backend redirects to
 * /auth/callback?token=<jwt> after a successful login. This component
 * extracts the token and delegates to AuthService.
 */
@Component({
  selector: 'app-auth-callback',
  imports: [],
  template: `<p>Signing in…</p>`
})
export class AuthCallbackComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (token) {
      this.auth.handleCallback(token);
    } else {
      this.auth.logout();
    }
  }
}
