import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { PreferencesService } from '../../../../../core/services/preferences.service';

interface MealWindow {
  from: ReturnType<typeof signal<string>>;
  to: ReturnType<typeof signal<string>>;
}

function timeToApi(t: string): string {
  return t.includes(':') && t.split(':').length === 2 ? `${t}:00` : t;
}

@Component({
  selector: 'app-meal-times-substep',
  standalone: true,
  imports: [],
  template: `
    <div class="meal-times">
      @for (slot of slots; track slot.key) {
        <div class="meal-slot-card">
          <div class="card-header">{{ slot.label }}</div>
          <div class="card-body">
            <label class="time-label">From
              <input type="time" [value]="slot.window.from()"
                (change)="slot.window.from.set(asTime($event))" />
            </label>
            <label class="time-label">To
              <input type="time" [value]="slot.window.to()"
                (change)="slot.window.to.set(asTime($event))" />
            </label>
          </div>
        </div>
      }
      <p class="note">Tasks are generally not scheduled during meal windows.</p>
      @if (saveError()) {
        <p class="error">Something went wrong — please try again.</p>
      }
    </div>
  `,
  styles: [`
    .meal-times { display: flex; flex-direction: column; gap: 12px; }
    .meal-slot-card {
      border: 1.5px solid var(--color-accent-border, #fde68a);
      border-radius: 10px; overflow: hidden;
    }
    .card-header {
      background: var(--color-accent-light, #fef3c7);
      padding: 8px 14px;
      font-size: 12px; font-weight: 700; text-transform: uppercase;
      color: var(--color-accent-dark, #78350f);
    }
    .card-body { padding: 12px 14px; display: flex; gap: 24px; flex-wrap: wrap; }
    .time-label { font-size: 12px; font-weight: 600; color: #374151; display: flex; flex-direction: column; gap: 4px; }
    .time-label input {
      border: 1.5px solid var(--color-accent-border, #fde68a);
      border-radius: 6px; padding: 5px 8px; font-size: 13px;
    }
    .note { font-size: 12px; color: #6b7280; margin: 4px 0 0; }
    .error { color: #dc2626; font-size: 12px; margin: 4px 0 0; }
  `],
})
export class MealTimesSubstepComponent {
  @Output() complete = new EventEmitter<void>();

  private readonly preferencesService = inject(PreferencesService);

  readonly breakfast: MealWindow = { from: signal('07:00'), to: signal('09:00') };
  readonly lunch: MealWindow = { from: signal('12:00'), to: signal('13:30') };
  readonly dinner: MealWindow = { from: signal('18:00'), to: signal('20:00') };
  readonly saveError = signal(false);

  readonly slots = [
    { key: 'breakfast', label: 'Breakfast', window: this.breakfast },
    { key: 'lunch', label: 'Lunch', window: this.lunch },
    { key: 'dinner', label: 'Dinner', window: this.dinner },
  ];

  protected asTime(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  save(): void {
    this.saveError.set(false);
    this.preferencesService
      .patchPreferences({
        breakfast_window_start: timeToApi(this.breakfast.from()),
        breakfast_window_end:   timeToApi(this.breakfast.to()),
        lunch_window_start:     timeToApi(this.lunch.from()),
        lunch_window_end:       timeToApi(this.lunch.to()),
        dinner_window_start:    timeToApi(this.dinner.from()),
        dinner_window_end:      timeToApi(this.dinner.to()),
      })
      .subscribe({
        next: () => this.complete.emit(),
        error: () => this.saveError.set(true),
      });
  }
}
