import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { PreferencesService } from '../../core/services/preferences.service';
import { Theme } from '../../core/models/preferences';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="settings-page">
      <div class="settings-header">
        <button class="back-btn" (click)="goBack()">← Back</button>
        <h1>Settings</h1>
      </div>

      @if (!preferencesService.preferences()) {
        <p class="loading-text">Loading settings…</p>
      } @else {
        <form class="settings-form">
          <div class="form-field">
            <label for="theme">Theme</label>
            <select id="theme" [formControl]="themeControl">
              <option value="system">System default</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          @if (successMessage) {
            <p class="status-success">{{ successMessage }}</p>
          }
          @if (errorMessage) {
            <p class="status-error">{{ errorMessage }}</p>
          }

          <div class="form-actions">
            <button
              type="button"
              class="btn btn--primary"
              [disabled]="pending || themeControl.pristine"
              (click)="save()"
            >
              {{ pending ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </form>
      }
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
      color: #6366f1;
      padding: 0.25rem 0.5rem;
    }

    .back-btn:hover { text-decoration: underline; }

    h1 { margin: 0; font-size: 1.5rem; }

    .loading-text { color: #6b7280; }

    .settings-form { display: flex; flex-direction: column; gap: 1.25rem; }

    .form-field { display: flex; flex-direction: column; gap: 0.375rem; }

    label { font-size: 0.875rem; font-weight: 500; color: #374151; }

    select {
      padding: 0.5rem 0.75rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.875rem;
      background: #fff;
      outline: none;
      cursor: pointer;
      transition: border-color 0.15s ease;
    }

    select:focus { border-color: #6366f1; }

    .status-success { color: #16a34a; font-size: 0.875rem; margin: 0; }
    .status-error   { color: #dc2626; font-size: 0.875rem; margin: 0; }

    .form-actions { display: flex; justify-content: flex-end; }

    .btn {
      padding: 0.5rem 1.25rem;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s ease;
    }

    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn--primary { background: #6366f1; color: #fff; }
    .btn--primary:hover:not(:disabled) { background: #4f46e5; }
  `]
})
export class SettingsComponent implements OnInit {
  readonly preferencesService = inject(PreferencesService);
  private readonly router = inject(Router);

  pending = false;
  successMessage = '';
  errorMessage = '';

  readonly themeControl = new FormControl<Theme>('system', { nonNullable: true });

  ngOnInit(): void {
    this.preferencesService.loadPreferences();
    const prefs = this.preferencesService.preferences();
    if (prefs) {
      this.themeControl.reset(prefs.theme);
    }
  }

  save(): void {
    if (this.pending) return;

    this.pending = true;
    this.successMessage = '';
    this.errorMessage = '';

    this.preferencesService.updatePreferences({ theme: this.themeControl.value }).subscribe({
      next: () => {
        this.pending = false;
        this.successMessage = 'Settings saved.';
        this.themeControl.markAsPristine();
      },
      error: () => {
        this.pending = false;
        this.errorMessage = 'Failed to save. Please try again.';
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
