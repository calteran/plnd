import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  imports: [],
  template: `
    <div>
      <h2>Dashboard</h2>
      <p>Welcome! You are signed in.</p>
      <button (click)="signOut()">Sign out</button>
    </div>
  `
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);

  signOut(): void {
    this.auth.logout();
  }
}
