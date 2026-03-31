import { Component, OnInit, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { PreferencesService } from '../../core/services/preferences.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="settings-page">
      <div class="settings-header">
        <button class="back-btn" type="button" (click)="goBack()">← Back</button>
        <h1>Settings</h1>
      </div>

      @if (preferencesService.preferences()) {
        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="settings-section">
            <h2>Planning</h2>

            <label for="weekStartDay">Week starts on</label>
            <select id="weekStartDay" formControlName="weekStartDay">
              <option [ngValue]="0">Sunday</option>
              <option [ngValue]="1">Monday</option>
              <option [ngValue]="2">Tuesday</option>
              <option [ngValue]="3">Wednesday</option>
              <option [ngValue]="4">Thursday</option>
              <option [ngValue]="5">Friday</option>
              <option [ngValue]="6">Saturday</option>
            </select>

            <label for="planLengthDays">Plan horizon length (days)</label>
            <input id="planLengthDays" type="number" min="1" max="90"
                   formControlName="planLengthDays" class="settings-input" />

            <label for="planningTriggerOffset">Planning reminder (days before/after horizon start)</label>
            <input id="planningTriggerOffset" type="number" min="-14" max="14"
                   formControlName="planningTriggerOffset" class="settings-input" />
          </div>

          <button type="submit" [disabled]="pending">Save</button>
          @if (successMessage) {
            <p class="status-success">{{ successMessage }}</p>
          }
          @if (errorMessage) {
            <p class="status-error">{{ errorMessage }}</p>
          }
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
      color: var(--color-accent);
      padding: 0.25rem 0.5rem;
    }

    .back-btn:hover { text-decoration: underline; }

    h1 { margin: 0; font-size: 1.5rem; }

    .settings-section { margin-bottom: 2rem; }

    label {
      display: block;
      margin-top: 1rem;
      margin-bottom: 0.25rem;
      font-size: 0.875rem;
    }

    select, .settings-input {
      display: block;
      width: 100%;
      padding: 0.5rem;
      border: 1px solid var(--color-border, #ccc);
      border-radius: 4px;
    }

    .status-success { color: var(--color-success); font-size: 0.875rem; margin: 0.75rem 0 0; }
    .status-error   { color: var(--color-destructive); font-size: 0.875rem; margin: 0.75rem 0 0; }
  `]
})
export class SettingsComponent implements OnInit {
  private readonly router = inject(Router);
  readonly preferencesService = inject(PreferencesService);

  readonly form = new FormGroup({
    weekStartDay: new FormControl<number>(1, { nonNullable: true, validators: [Validators.min(0), Validators.max(6)] }),
    planLengthDays: new FormControl<number>(7, { nonNullable: true, validators: [Validators.min(1), Validators.max(90)] }),
    planningTriggerOffset: new FormControl<number>(0, { nonNullable: true, validators: [Validators.min(-14), Validators.max(14)] }),
  });

  pending = false;
  successMessage = '';
  errorMessage = '';
  private prefsInitialized = false;

  constructor() {
    // Sync form once when preferences first load — they arrive asynchronously after
    // ngOnInit. The guard prevents subsequent preference signal updates (e.g. after
    // a PATCH /preferences/me response) from overwriting the user's in-progress edits.
    effect(() => {
      const prefs = this.preferencesService.preferences();
      if (!prefs || this.prefsInitialized) return;
      this.prefsInitialized = true;
      this.form.patchValue({
        weekStartDay: prefs.week_start_day,
        planLengthDays: prefs.default_plan_length_days,
        planningTriggerOffset: prefs.planning_trigger_offset,
      });
    });
  }

  ngOnInit(): void {
    this.preferencesService.loadPreferences();
  }

  goBack(): void {
    this.router.navigate(['/today']);
  }

  save(): void {
    this.successMessage = '';
    this.errorMessage = '';
    if (!this.form.valid) {
      this.errorMessage = 'Please correct the invalid values before saving.';
      return;
    }
    const v = this.form.getRawValue();
    this.pending = true;
    this.preferencesService.patchPreferences({
      week_start_day: v.weekStartDay,
      default_plan_length_days: v.planLengthDays,
      planning_trigger_offset: v.planningTriggerOffset,
    }).subscribe({
      next: () => { this.pending = false; this.successMessage = 'Settings saved.'; },
      error: () => { this.pending = false; this.errorMessage = 'Failed to save settings.'; }
    });
  }
}
