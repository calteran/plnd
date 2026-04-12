import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';
import { UserService } from '../../core/services/user.service';
import { DietaryRestrictionsService } from '../../core/services/dietary-restrictions.service';
import { RestrictionType, RESTRICTION_TYPES } from '../../core/models/dietary-restriction';

type OnboardingStep = 'welcome' | 'profile' | 'restrictions';

const STEP_NUMBERS: Record<OnboardingStep, number> = {
  welcome: 1,
  profile: 2,
  restrictions: 3
};
const TOTAL_STEPS = 3;

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

              <form class="step-form" (submit)="$event.preventDefault(); saveProfile()">
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
  styleUrl: './onboarding.scss',
})
export class OnboardingComponent implements OnInit {
  private readonly userService = inject(UserService);
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

    // Kick off lazy load so data is ready by the time user reaches the restrictions step
    this.dietaryService.load();
  }

  advanceFromWelcome(): void {
    this.step.set('profile');
  }

  skipProfile(): void {
    this.errorMessage = '';
    this.step.set('restrictions');
  }

  saveProfile(): void {
    if (this.pending || this.profileForm.invalid) return;
    const name = this.profileForm.controls.display_name.value.trim();
    if (!name) {
      this.step.set('restrictions');
      return;
    }

    this.pending = true;
    this.errorMessage = '';
    this.userService.updateUser({ display_name: name }).subscribe({
      next: () => {
        this.pending = false;
        this.step.set('restrictions');
      },
      error: () => {
        this.pending = false;
        this.errorMessage = 'Failed to save profile. Please try again.';
      }
    });
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
        this.router.navigate(['/today']);
      },
      error: () => {
        this.pending = false;
        this.errorMessage = 'Failed to complete setup. Please try again.';
      }
    });
  }
}
