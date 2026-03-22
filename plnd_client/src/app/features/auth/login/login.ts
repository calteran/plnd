import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [],
  template: `
    <div class="login-page">
      <h1>Welcome to PLND</h1>
      <p>Your neurodivergent-friendly planner</p>
      @if (sessionExpired) {
        <p class="session-notice">Your session has expired. Please sign in again.</p>
      }
      <button (click)="signIn()">Sign in with Mock OAuth</button>
    </div>
  `,
  styles: [`
    .login-page {
      text-align: center;
      padding: 2rem;
    }
    button {
      margin-top: 1.5rem;
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      cursor: pointer;
    }
    .session-notice {
      color: #b45309;
      background: #fef3c7;
      border: 1px solid #fcd34d;
      border-radius: 4px;
      padding: 0.5rem 1rem;
      margin-top: 1rem;
      display: inline-block;
    }
  `]
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  readonly sessionExpired =
    inject(ActivatedRoute).snapshot.queryParamMap.get('reason') === 'session_expired';

  signIn(): void {
    this.auth.login();
  }
}
