import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-settings',
  standalone: true,
  template: `
    <div class="settings-page">
      <div class="settings-header">
        <button class="back-btn" (click)="goBack()">← Back</button>
        <h1>Settings</h1>
      </div>
      <p class="placeholder">More settings coming soon.</p>
    </div>
  `,
  styles: [`
    .settings-page {
      max-width: 600px;
      margin: 0 auto;
      padding: 1.5rem;
    }

    .settings-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.875rem;
      color: var(--color-accent);
      padding: 0.25rem 0.5rem;
    }

    .back-btn:hover { text-decoration: underline; }

    h1 { margin: 0; font-size: 1.5rem; }

    .placeholder { color: var(--color-text-muted); font-size: 0.875rem; }
  `]
})
export class SettingsComponent {
  private readonly router = inject(Router);

  goBack(): void {
    this.router.navigate(['/today']);
  }
}
