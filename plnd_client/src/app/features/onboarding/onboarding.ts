import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';
import { UserService } from '../../core/services/user.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { DietaryRestrictionsService } from '../../core/services/dietary-restrictions.service';
import { ThemeService, EffectiveTheme } from '../../core/services/theme.service';
import { RestrictionType, RESTRICTION_TYPES } from '../../core/models/dietary-restriction';

type OnboardingStep = 'welcome' | 'profile' | 'preferences' | 'restrictions';

const STEP_NUMBERS: Record<OnboardingStep, number> = {
  welcome: 1,
  profile: 2,
  preferences: 3,
  restrictions: 4
};
const TOTAL_STEPS = 4;

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [ReactiveFormsModule, TitleCasePipe],
  template: `
    <div class="onboarding-shell">
      <div class="onboarding-card">
        <!-- Progress bar -->
        <div class="progress-bar" role="progressbar"
             [attr.aria-valuenow]="progressPercent()"
             aria-valuemin="0" aria-valuemax="100">
          <div class="progress-fill" [style.width.%]="progressPercent()"></div>
        </div>
        <p class="step-label">Step {{ stepNumber() }} of {{ totalSteps }}</p>

        @switch (step()) {

          @case ('welcome') {
            <div class="step-content">
              <h1 class="step-title">Welcome to PLND!</h1>
              <p class="step-desc">
                Let's take a moment to set up your planner. Every step is optional —
                skip anything you'd rather configure later.
              </p>
              <div class="step-actions">
                <button type="button" class="btn btn--primary btn--full"
                        (click)="advanceFromWelcome()">
                  Get Started
                </button>
              </div>
            </div>
          }

          @case ('profile') {
            <div class="step-content">
              <h1 class="step-title">Your Profile</h1>
              <p class="step-desc">How should we address you?</p>

              <form class="step-form">
                <div class="form-field">
                  <label for="display-name">Display name (optional)</label>
                  <input
                    id="display-name"
                    type="text"
                    [formControl]="profileForm.controls.display_name"
                    maxlength="100"
                    placeholder="e.g. Alex"
                    autocomplete="nickname"
                  />
                </div>
              </form>

              @if (errorMessage) {
                <p class="status-error">{{ errorMessage }}</p>
              }

              <div class="step-actions step-actions--two">
                <button type="button" class="btn btn--secondary"
                        [disabled]="pending"
                        (click)="skipProfile()">
                  Skip
                </button>
                <button type="button" class="btn btn--primary"
                        [disabled]="pending || profileForm.invalid"
                        (click)="saveProfile()">
                  {{ pending ? 'Saving…' : 'Next Step →' }}
                </button>
              </div>
            </div>
          }

          @case ('preferences') {
            <div class="step-content">
              <h1 class="step-title">Theme</h1>
              <p class="step-desc">Choose your preferred colour scheme.</p>

              <form class="step-form">
                <div class="form-field">
                  <label for="theme">Theme</label>
                  <select id="theme" [formControl]="themeControl">
                    <option value="system">System default</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
              </form>

              @if (errorMessage) {
                <p class="status-error">{{ errorMessage }}</p>
              }

              <div class="step-actions step-actions--two">
                <button type="button" class="btn btn--secondary"
                        [disabled]="pending"
                        (click)="skipPreferences()">
                  Skip
                </button>
                <button type="button" class="btn btn--primary"
                        [disabled]="pending"
                        (click)="savePreferences()">
                  {{ pending ? 'Saving…' : 'Next Step →' }}
                </button>
              </div>
            </div>
          }

          @case ('restrictions') {
            <div class="step-content">
              <h1 class="step-title">Dietary Restrictions</h1>
              <p class="step-desc">Add any allergies, intolerances, or food preferences.</p>

              <!-- Existing restrictions list -->
              @if ((dietaryService.restrictions()?.length ?? 0) > 0) {
                <ul class="restriction-chips">
                  @for (item of dietaryService.restrictions(); track item.restriction_id) {
                    <li class="chip">
                      <span class="chip-type">{{ item.restriction_type | titlecase }}</span>
                      <span class="chip-name">{{ item.name }}</span>
                    </li>
                  }
                </ul>
              }

              <!-- Add restriction form -->
              <form class="step-form step-form--compact" [formGroup]="addRestrictionForm">
                <div class="form-row">
                  <div class="form-field form-field--narrow">
                    <label for="r-type">Type</label>
                    <select id="r-type" formControlName="restriction_type">
                      @for (t of restrictionTypes; track t) {
                        <option [value]="t">{{ t | titlecase }}</option>
                      }
                    </select>
                  </div>
                  <div class="form-field form-field--grow">
                    <label for="r-name">Name</label>
                    <input id="r-name" type="text" formControlName="name"
                           maxlength="100" placeholder="e.g. peanuts" />
                  </div>
                </div>
                <div class="form-field">
                  <label for="r-notes">Notes (optional)</label>
                  <textarea id="r-notes" formControlName="notes"
                            maxlength="500" rows="2"
                            placeholder="Optional notes…"></textarea>
                </div>
                <button type="button" class="btn btn--secondary btn--full"
                        [disabled]="pending || addRestrictionForm.invalid"
                        (click)="addRestriction()">
                  {{ pending ? 'Adding…' : 'Add' }}
                </button>
              </form>

              @if (errorMessage) {
                <p class="status-error">{{ errorMessage }}</p>
              }

              <div class="step-actions step-actions--two">
                <button type="button" class="btn btn--secondary"
                        [disabled]="pending"
                        (click)="skipRestrictions()">
                  Skip
                </button>
                <button type="button" class="btn btn--primary"
                        [disabled]="pending"
                        (click)="finish()">
                  {{ pending ? 'Finishing…' : 'Done' }}
                </button>
              </div>
            </div>
          }

        }
      </div>
    </div>
  `,
  styles: [`
    .onboarding-shell {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f3f4f6;
      padding: 1.5rem;
    }

    .onboarding-card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      padding: 2rem;
      width: 100%;
      max-width: 480px;
    }

    .progress-bar {
      height: 6px;
      background: #e5e7eb;
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 0.5rem;
    }

    .progress-fill {
      height: 100%;
      background: #6366f1;
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .step-label {
      font-size: 0.75rem;
      color: #9ca3af;
      margin: 0 0 1.5rem;
      text-align: right;
    }

    .step-content { display: flex; flex-direction: column; gap: 1rem; }

    .step-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: #111827;
      margin: 0;
    }

    .step-desc {
      color: #6b7280;
      font-size: 0.9375rem;
      margin: 0;
      line-height: 1.5;
    }

    .step-form {
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
    }

    .step-form--compact { gap: 0.625rem; }

    .form-field { display: flex; flex-direction: column; gap: 0.375rem; }

    .form-field--narrow { flex: 0 0 140px; }
    .form-field--grow { flex: 1; }

    .form-row { display: flex; gap: 0.75rem; align-items: flex-end; }

    label {
      font-size: 0.875rem;
      font-weight: 500;
      color: #374151;
    }

    input, select, textarea {
      padding: 0.5rem 0.75rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.875rem;
      background: #fff;
      font-family: inherit;
      width: 100%;
      box-sizing: border-box;
    }

    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: #6366f1;
    }

    textarea { resize: vertical; }

    .step-actions { display: flex; margin-top: 0.5rem; }

    .step-actions--two { gap: 0.75rem; }

    .btn {
      padding: 0.5625rem 1.25rem;
      border-radius: 6px;
      font-size: 0.9375rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s ease;
    }

    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn--full { width: 100%; }

    .btn--primary { background: #6366f1; color: #fff; flex: 1; }
    .btn--primary:hover:not(:disabled) { background: #4f46e5; }

    .btn--secondary { background: #e5e7eb; color: #374151; flex: 1; }
    .btn--secondary:hover:not(:disabled) { background: #d1d5db; }

    .status-error { color: #dc2626; font-size: 0.875rem; margin: 0; }

    .restriction-chips {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .chip {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      background: #ede9fe;
      border-radius: 999px;
      padding: 0.25rem 0.75rem;
      font-size: 0.8125rem;
    }

    .chip-type { color: #7c3aed; font-weight: 600; }
    .chip-name { color: #374151; }
  `]
})
export class OnboardingComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly themeService = inject(ThemeService);
  readonly dietaryService = inject(DietaryRestrictionsService);
  private readonly router = inject(Router);

  readonly step = signal<OnboardingStep>('welcome');
  readonly stepNumber = computed(() => STEP_NUMBERS[this.step()]);
  readonly progressPercent = computed(() => (this.stepNumber() / TOTAL_STEPS) * 100);
  readonly totalSteps = TOTAL_STEPS;

  readonly restrictionTypes: RestrictionType[] = RESTRICTION_TYPES;

  pending = false;
  errorMessage = '';

  readonly profileForm = new FormGroup({
    display_name: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] })
  });

  readonly themeControl = new FormControl<EffectiveTheme | 'system'>('system', { nonNullable: true });

  readonly addRestrictionForm = new FormGroup({
    restriction_type: new FormControl<RestrictionType>('allergy', { nonNullable: true }),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    notes: new FormControl<string | null>(null)
  });

  ngOnInit(): void {
    // Pre-populate profile form if user is already loaded
    const user = this.userService.user();
    if (user?.display_name) {
      this.profileForm.controls.display_name.setValue(user.display_name);
    }

    // Pre-populate theme based on current effective theme
    this.themeControl.setValue(this.themeService.effectiveTheme());

    // Kick off lazy loads so data is ready by the time user reaches those steps
    this.preferencesService.loadPreferences();
    this.dietaryService.load();
  }

  advanceFromWelcome(): void {
    this.step.set('profile');
  }

  skipProfile(): void {
    this.errorMessage = '';
    this.step.set('preferences');
  }

  saveProfile(): void {
    if (this.pending || this.profileForm.invalid) return;
    const name = this.profileForm.controls.display_name.value.trim();
    if (!name) {
      this.step.set('preferences');
      return;
    }

    this.pending = true;
    this.errorMessage = '';
    this.userService.updateUser({ display_name: name }).subscribe({
      next: () => {
        this.pending = false;
        this.step.set('preferences');
      },
      error: () => {
        this.pending = false;
        this.errorMessage = 'Failed to save profile. Please try again.';
      }
    });
  }

  skipPreferences(): void {
    this.errorMessage = '';
    this.step.set('restrictions');
  }

  savePreferences(): void {
    if (this.pending) return;
    this.errorMessage = '';
    const selected = this.themeControl.value;
    const current = this.themeService.effectiveTheme();
    // Apply override if the user explicitly chose a theme that differs from current effective
    if (selected !== 'system' && selected !== current) {
      this.themeService.toggle();
    } else if (selected === 'system' && this.themeService.isOverridden()) {
      this.themeService.toggle();
    }
    this.step.set('restrictions');
  }

  addRestriction(): void {
    if (this.pending || this.addRestrictionForm.invalid) return;
    this.pending = true;
    this.errorMessage = '';

    const { restriction_type, name, notes } = this.addRestrictionForm.getRawValue();
    const req = {
      restriction_type,
      name,
      ...(notes?.trim() ? { notes: notes.trim() } : {})
    };

    this.dietaryService.create(req).subscribe({
      next: () => {
        this.pending = false;
        this.addRestrictionForm.reset({ restriction_type: 'allergy', name: '', notes: null });
      },
      error: (err) => {
        this.pending = false;
        if (err.status === 409) {
          this.errorMessage = 'A restriction with this type and name already exists.';
        } else {
          this.errorMessage = 'Failed to add restriction. Please try again.';
        }
      }
    });
  }

  skipRestrictions(): void {
    this.finish();
  }

  finish(): void {
    if (this.pending) return;
    this.pending = true;
    this.errorMessage = '';
    this.userService.completeOnboarding().subscribe({
      next: () => {
        this.pending = false;
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.pending = false;
        this.errorMessage = 'Failed to complete setup. Please try again.';
      }
    });
  }
}
