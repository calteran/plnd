import { Component, DestroyRef, OnInit, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { SpokeChromeComponent } from '../shared/spoke-chrome/spoke-chrome';
import { UserService } from '../../../core/services/user.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { OnboardingStateService } from '../onboarding-state.service';
import { TimezoneService } from '../../../core/services/timezone.service';

@Component({
  selector: 'app-onboarding-account',
  standalone: true,
  imports: [SpokeChromeComponent],
  template: `
    <app-spoke-chrome
      title="Account Settings"
      [totalSteps]="1"
      [currentStep]="1"
      (continueClick)="onSave()">

      <div class="account-form">

        <!-- Display Name -->
        <div class="field-group">
          <label class="field-label" for="displayName">Display Name</label>
          <input
            id="displayName"
            type="text"
            class="text-input"
            [value]="displayName()"
            (input)="displayName.set($any($event.target).value)"
            autocomplete="name"
          />
          <span class="field-hint">Used in greetings and plan summaries.</span>
        </div>

        <!-- Email (display only — managed by OAuth provider) -->
        <div class="field-group">
          <label class="field-label">Email</label>
          <span class="email-display">{{ email() }}</span>
        </div>

        <!-- Notifications section -->
        <h3 class="section-heading">Notifications</h3>
        <p class="section-desc">
          PLND can remind you when it's time to plan your week, log a meal, or check off tasks.
        </p>

        <!-- Email notifications -->
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">Email</span>
            <span class="toggle-subtitle">{{ email() }}</span>
          </div>
          <input
            type="checkbox"
            class="toggle"
            [checked]="emailNotifications()"
            (change)="emailNotifications.set($any($event.target).checked)"
            aria-label="Email notifications"
          />
        </div>

        <!-- SMS notifications -->
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">SMS</span>
          </div>
          <input
            type="checkbox"
            class="toggle"
            [checked]="smsNotifications()"
            (change)="onSmsToggle($any($event.target).checked)"
            aria-label="SMS notifications"
          />
        </div>
        @if (smsNotifications()) {
          <input
            type="tel"
            class="text-input phone-input"
            placeholder="Phone number"
            [value]="phoneNumber()"
            (input)="phoneNumber.set($any($event.target).value)"
            aria-label="Phone number"
          />
        }

        <!-- Push notifications -->
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-label">Push</span>
          </div>
          <input
            type="checkbox"
            class="toggle"
            [checked]="pushNotifications()"
            (change)="onPushToggle($any($event.target).checked)"
            aria-label="Push notifications"
          />
        </div>

        <!-- Future placeholder -->
        <div class="future-placeholder">
          More settings — integrations, accessibility, timezone — coming in a future update.
        </div>

        @if (saveError()) {
          <p class="save-error">Something went wrong — your settings weren't saved. Please try again.</p>
        }

      </div>
    </app-spoke-chrome>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .account-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* ── Field groups ─────────────────────────────────────────── */

    .field-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .field-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--color-accent-dark);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .text-input {
      border: 1.5px solid var(--color-accent-border);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 14px;
      color: var(--color-text-body);
      background: var(--color-surface-white);
      outline: none;
      transition: border-color 0.15s;
      width: 100%;
      box-sizing: border-box;
    }

    .text-input:focus {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
    }

    .field-hint {
      font-size: 11px;
      color: var(--color-text-muted);
    }

    /* ── Email display (read-only) ────────────────────────────── */

    .email-display {
      font-size: 14px;
      color: var(--color-text-muted);
      padding: 4px 0;
    }

    /* ── Section heading ──────────────────────────────────────── */

    .section-desc {
      margin: -4px 0 4px;
      font-size: 13px;
      color: var(--color-text-muted);
    }

    .section-heading {
      font-size: 12px;
      font-weight: 700;
      color: var(--color-accent-dark);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 4px 0 0;
    }

    /* ── Toggle rows ──────────────────────────────────────────── */

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border: 1.5px solid var(--color-accent-border);
      border-radius: 10px;
      background: var(--color-accent-light);
    }

    .toggle-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .toggle-label {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .toggle-subtitle {
      font-size: 11px;
      color: var(--color-accent-dark);
      opacity: 0.8;
    }

    .toggle {
      width: 18px;
      height: 18px;
      accent-color: var(--color-accent);
      cursor: pointer;
    }

    .phone-input {
      margin-top: -8px;
    }

    /* ── Future placeholder ───────────────────────────────────── */

    .future-placeholder {
      border: 1.5px dashed var(--color-accent-border);
      border-radius: 10px;
      background: var(--color-accent-light);
      color: var(--color-accent-dark);
      font-size: 12px;
      padding: 12px;
      text-align: center;
      opacity: 0.8;
    }

    /* ── Save error ───────────────────────────────────────────── */

    .save-error {
      font-size: 13px;
      color: var(--color-destructive);
      background: var(--color-destructive-light);
      border: 1.5px solid var(--color-destructive-border);
      border-radius: 6px;
      padding: 10px 12px;
      margin: 0;
    }
  `],
})
export class OnboardingAccountComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly state = inject(OnboardingStateService);
  private readonly router = inject(Router);
  private readonly tz = inject(TimezoneService);
  private readonly destroyRef = inject(DestroyRef);

  private deviceZoneSeeded = false;

  readonly displayName = signal('');
  readonly email = signal('');
  readonly emailNotifications = signal(false);
  readonly smsNotifications = signal(false);
  readonly phoneNumber = signal('');
  readonly pushNotifications = signal(false);
  readonly saveError = signal(false);

  constructor() {
    effect(() => {
      const user = this.userService.user();
      if (user) {
        this.displayName.set(user.display_name ?? '');
        this.email.set(user.email);
      }
    });

    effect(() => {
      const prefs = this.preferencesService.preferences();
      if (prefs) {
        this.emailNotifications.set(prefs.email_notifications_enabled);
        this.smsNotifications.set(prefs.sms_notifications_enabled);
        this.pushNotifications.set(prefs.push_notifications_enabled);
        this.phoneNumber.set(prefs.phone_number ?? '');
      }
    });
  }

  ngOnInit(): void {
    this.userService.loadUser();
    this.preferencesService.loadPreferences();
    // Pre-fill is handled reactively by effects in the constructor
  }

  onSmsToggle(checked: boolean): void {
    this.smsNotifications.set(checked);
  }

  onPushToggle(checked: boolean): void {
    if (checked && 'Notification' in window) {
      Notification.requestPermission().then(p => {
        this.pushNotifications.set(p === 'granted');
      });
    } else {
      this.pushNotifications.set(false);
    }
  }

  onSave(): void {
    this.saveError.set(false);
    forkJoin([
      this.userService.updateUser({ display_name: this.displayName() }),
      this.preferencesService.patchPreferences({
        email_notifications_enabled: this.emailNotifications(),
        sms_notifications_enabled: this.smsNotifications(),
        push_notifications_enabled: this.pushNotifications(),
        phone_number: this.smsNotifications() ? (this.phoneNumber() || null) : null,
      }),
    ]).subscribe({
      next: () => {
        this.state.markComplete('account');
        this.router.navigate(['/onboarding']);
        if (!this.deviceZoneSeeded) {
          this.deviceZoneSeeded = true;
          this.tz.reportDeviceZone(this.tz.deviceZone())
            .pipe(takeUntilDestroyed(this.destroyRef))
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            .subscribe({ next: () => {}, error: () => {} }); // fire-and-forget; never block onboarding
        }
      },
      error: () => this.saveError.set(true),
    });
  }
}
