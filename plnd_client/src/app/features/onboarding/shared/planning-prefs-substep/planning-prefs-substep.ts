import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { OnboardingStateService } from '../../onboarding-state.service';
import { PreferencesService } from '../../../../core/services/preferences.service';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ABBREVS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

@Component({
  selector: 'app-planning-prefs-substep',
  standalone: true,
  imports: [],
  template: `
    @if (!state.planningPrefsComplete()) {
      <div class="planning-prefs">
        <div class="callout">
          A few quick questions to set up your planning rhythm.
          You'll only see this once.
        </div>

        <div class="field-group">
          <span class="field-label">Plan length</span>
          <div class="segmented-control">
            @for (opt of planLengthOptions; track opt.value) {
              <button
                type="button"
                class="seg-btn"
                [class.seg-btn--active]="planLength() === opt.value"
                (click)="planLength.set(opt.value)"
              >{{ opt.label }}</button>
            }
          </div>
        </div>

        <div class="field-group">
          <span class="field-label">Week starts on</span>
          <div class="day-row">
            @for (day of dayOptions; track day.value) {
              <button
                type="button"
                class="day-pill"
                [class.day-pill--active]="weekStart() === day.value"
                (click)="weekStart.set(day.value)"
                [title]="day.label"
                [attr.aria-label]="day.label"
              >{{ day.abbrev }}</button>
            }
          </div>
        </div>

        <div class="field-group">
          <span class="field-label">Planning day &amp; time</span>
          <div class="planning-day-row">
            <div class="day-row">
              @for (day of dayOptions; track day.value) {
                <button
                  type="button"
                  class="day-pill"
                  [class.day-pill--active]="planningDay() === day.value"
                  (click)="planningDay.set(day.value)"
                  [title]="day.label"
                  [attr.aria-label]="day.label"
                >{{ day.abbrev }}</button>
              }
            </div>
            <input
              type="time"
              class="time-input"
              aria-label="Planning time"
              [value]="planningTime()"
              (change)="onTimeChange($event)"
            />
          </div>
        </div>

        @if (saveError()) {
          <p class="save-error">Something went wrong — your settings weren't saved. Please try again.</p>
        }

        <p class="footer-note">
          You can update these after onboarding in
          <strong>Settings → Planning</strong>.
        </p>

        <button type="button" class="save-btn" [disabled]="isSaving()" (click)="save()">
          {{ isSaving() ? 'Saving…' : 'Save & Continue →' }}
        </button>
      </div>
    }
  `,
  styles: [`
    .planning-prefs {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .callout {
      background: var(--color-accent-light, #fef3c7);
      border: 1.5px solid var(--color-accent-border, #fde68a);
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 13px;
      color: var(--color-accent-dark, #78350f);
    }

    .field-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .field-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--color-accent-dark, #78350f);
    }

    .segmented-control {
      display: flex;
      border: 1.5px solid var(--color-accent-border, #fde68a);
      border-radius: 8px;
      overflow: hidden;
    }

    .seg-btn {
      flex: 1;
      background: var(--color-surface-white);
      border: none;
      border-right: 1.5px solid var(--color-accent-border, #fde68a);
      padding: 8px;
      font-size: 13px;
      cursor: pointer;
      color: var(--color-btn-neutral-text);
    }

    .seg-btn:last-child { border-right: none; }

    .seg-btn--active {
      background: var(--color-accent, #d97706);
      color: var(--color-btn-accent-text);
      font-weight: 700;
    }

    .day-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .day-pill {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1.5px solid var(--color-btn-neutral-border);
      background: var(--color-surface-white);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      color: var(--color-text-body);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .day-pill--active {
      background: var(--color-accent, #d97706);
      border-color: var(--color-accent, #d97706);
      color: var(--color-btn-accent-text);
    }

    .planning-day-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .time-input {
      border: 1.5px solid var(--color-accent-border, #fde68a);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 13px;
    }

    .save-error {
      color: var(--color-destructive);
      font-size: 12px;
      margin: 0;
    }

    .footer-note {
      font-size: 12px;
      color: var(--color-text-muted);
      margin: 0;
    }

    .save-btn {
      align-self: flex-end;
      background: var(--color-accent);
      color: var(--color-btn-accent-text);
      border: none;
      border-radius: 8px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: filter 0.15s;
    }

    .save-btn:hover:not([disabled]) { filter: brightness(0.88); }
  `],
})
export class PlanningPrefsSubstepComponent implements OnInit {
  @Output() complete = new EventEmitter<void>();

  readonly state = inject(OnboardingStateService);
  private readonly preferencesService = inject(PreferencesService);

  // Form state — public for test access
  readonly planLength = signal<7 | 14 | 28>(7);
  readonly weekStart = signal<number>(1); // Monday default
  readonly planningDay = signal<number>(0); // Sunday default
  readonly planningTime = signal<string>('15:00');
  readonly saveError = signal(false);
  readonly isSaving = signal(false);

  readonly planLengthOptions: { value: 7 | 14 | 28; label: string }[] = [
    { value: 7, label: '1 week' },
    { value: 14, label: '2 weeks' },
    { value: 28, label: '4 weeks' },
  ];

  readonly dayOptions = DAY_LABELS.map((label, i) => ({
    value: i,
    label,
    abbrev: DAY_ABBREVS[i],
  }));

  ngOnInit(): void {
    if (this.state.planningPrefsComplete()) {
      this.complete.emit();
    }
  }

  onTimeChange(event: Event): void {
    this.planningTime.set((event.target as HTMLInputElement).value);
  }

  save(): void {
    if (this.isSaving()) return;
    // planning_trigger_offset: signed days from plan start to the planning day.
    // Formula: -((weekStart - planningDay + 7) % 7)
    // e.g. weekStart=Mon(1), planningDay=Sun(0) → -1; planningDay=Mon(1) → 0; planningDay=Sat(6) → -2
    const raw = (this.weekStart() - this.planningDay() + 7) % 7;
    const offset = raw === 0 ? 0 : -raw;
    this.saveError.set(false);
    this.isSaving.set(true);
    this.preferencesService
      .patchPreferences({
        default_plan_length_days: this.planLength(),
        week_start_day: this.weekStart(),
        planning_trigger_offset: offset,
        planning_time: this.planningTime() + ':00',
      })
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          const d = new Date();
          const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          this.state.setPlanningPrefsComplete();
          this.state.computeAndSetPlanPeriod(today);
          this.complete.emit();
        },
        error: () => {
          this.isSaving.set(false);
          this.saveError.set(true);
        },
      });
  }
}
