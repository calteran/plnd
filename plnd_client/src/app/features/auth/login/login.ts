import { Component, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [],
  template: `
    <div class="login-page">
      <h1>Welcome to PLND</h1>
      <p>Your neurodivergent-friendly planner</p>
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
  `]
})
export class LoginComponent {
  private readonly auth = inject(AuthService);

  signIn(): void {
    this.auth.login();
  }
}
