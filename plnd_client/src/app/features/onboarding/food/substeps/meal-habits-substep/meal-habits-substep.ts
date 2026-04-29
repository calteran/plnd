import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { MealHabitsService } from '../../../../../core/services/meal-habits.service';
import { OnboardingStateService } from '../../../onboarding-state.service';
import { MealHabitSlot } from '../../../../../core/models/meal-habit';

export type RecurrenceOption = 'Every day' | 'Weekdays' | 'Weekends' | 'Weekly…';

const RRULE_MAP: Record<Exclude<RecurrenceOption, 'Weekly…'>, string> = {
  'Every day': 'FREQ=DAILY',
  'Weekdays':  'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  'Weekends':  'FREQ=WEEKLY;BYDAY=SA,SU',
};

const DAY_BYDAY: Record<number, string> = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' };
const DAY_ABBREVS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function buildRrule(recurrence: RecurrenceOption, weeklyDay: number): string {
  if (recurrence !== 'Weekly…') return RRULE_MAP[recurrence];
  return `FREQ=WEEKLY;BYDAY=${DAY_BYDAY[weeklyDay]}`;
}

@Component({
  selector: 'app-meal-habits-substep',
  standalone: true,
  imports: [],
  template: `
    <div class="meal-habits">
      <p class="description">Tell us about meals you have on a regular basis — they'll be scheduled in your plan automatically.</p>

      <div class="entry-card">
        <input type="text" class="name-input" placeholder="Meal name"
          [value]="mealName()" (input)="mealName.set(asText($event))" />

        <div class="pills-row">
          @for (s of slots; track s) {
            <button type="button" class="pill" [class.pill--active]="slot() === s" (click)="slot.set(s)">{{ capitalize(s) }}</button>
          }
        </div>

        <div class="pills-row">
          @for (r of recurrenceOptions; track r) {
            <button type="button" class="pill" [class.pill--active]="recurrence() === r" (click)="recurrence.set(r)">{{ r }}</button>
          }
        </div>

        @if (recurrence() === 'Weekly…') {
          <div class="day-picker pills-row">
            @for (day of dayAbbrevs; track $index) {
              <button type="button" class="pill pill--circle"
                [class.pill--active]="weeklyDay() === $index"
                (click)="weeklyDay.set($index)"
              >{{ day }}</button>
            }
          </div>
        }

        @if (conflictWarning()) {
          <p class="conflict-warning">{{ conflictWarning() }}</p>
        }

        <button type="button" class="btn-add" (click)="add()">
          {{ conflictWarning() ? 'Add anyway' : 'Add' }}
        </button>

        @if (addError()) {
          <p class="error">Failed to add — please try again.</p>
        }
      </div>

      <div class="chips">
        @for (h of habitsService.habits(); track h.id) {
          <span class="habit-chip">
            {{ h.meal_name }} · {{ capitalize(h.slot) }} · {{ recurrenceLabel(h.recurrence_rule) }}
            <button type="button" (click)="remove(h.id)">✕</button>
          </span>
        }
      </div>
    </div>
  `,
  styles: [`
    .meal-habits { display: flex; flex-direction: column; gap: 14px; }
    .description { font-size: 13px; color: var(--color-text-muted); margin: 0; }
    .entry-card { border: 1.5px solid var(--color-accent-border); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .name-input { border: 1.5px solid var(--color-border-input); border-radius: 6px; padding: 7px 10px; font-size: 13px; width: 100%; box-sizing: border-box; }
    .pills-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .pill { border: 1.5px solid var(--color-border-input); background: var(--color-surface-white); border-radius: 20px; padding: 4px 12px; font-size: 12px; cursor: pointer; color: var(--color-btn-neutral-text); }
    .pill--active { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-btn-accent-text); font-weight: 700; }
    .pill--circle { width: 30px; height: 30px; border-radius: 50%; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
    .btn-add { align-self: flex-end; background: var(--color-accent); color: var(--color-btn-accent-text); border: none; border-radius: 6px; padding: 7px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
    .conflict-warning { font-size: 12px; color: var(--color-accent-dark); background: var(--color-accent-light); border: 1.5px solid var(--color-accent-border); border-radius: 6px; padding: 7px 10px; margin: 0; }
    .error { color: var(--color-destructive); font-size: 12px; margin: 0; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .habit-chip { background: var(--color-accent-light); border: 1.5px solid var(--color-accent-border); border-radius: 20px; padding: 4px 10px 4px 12px; font-size: 12px; color: var(--color-accent-dark); display: inline-flex; align-items: center; gap: 6px; }
    .habit-chip button { background: none; border: none; cursor: pointer; font-size: 11px; color: var(--color-accent); line-height: 1; }
  `],
})
export class MealHabitsSubstepComponent implements OnInit {
  @Output() complete = new EventEmitter<void>();

  readonly habitsService = inject(MealHabitsService);
  private readonly state = inject(OnboardingStateService);

  readonly mealName = signal('');
  readonly slot = signal<MealHabitSlot>('breakfast');
  readonly recurrence = signal<RecurrenceOption>('Every day');
  readonly weeklyDay = signal(1); // Monday default
  readonly addError = signal(false);

  readonly slots: MealHabitSlot[] = ['breakfast', 'lunch', 'dinner'];
  readonly recurrenceOptions: RecurrenceOption[] = ['Every day', 'Weekdays', 'Weekends', 'Weekly…'];
  readonly dayAbbrevs = DAY_ABBREVS;

  readonly conflictWarning = computed((): string | null => {
    const rrule = buildRrule(this.recurrence(), this.weeklyDay());
    const slot = this.slot();
    const existing = this.habitsService.habits().find(h => h.slot === slot && h.recurrence_rule === rrule);
    if (!existing) return null;
    return `${existing.meal_name} already fills ${this.capitalize(slot)} ${this.recurrence()}. Adding ${this.mealName() || 'this meal'} will give you two options — the planner will alternate between them.`;
  });

  ngOnInit(): void {
    this.habitsService.load();
  }

  protected asText(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  protected recurrenceLabel(rrule: string): string {
    if (rrule === 'FREQ=DAILY') return 'Every day';
    if (rrule.includes('MO,TU,WE,TH,FR')) return 'Weekdays';
    if (rrule.includes('SA,SU')) return 'Weekends';
    const match = rrule.match(/BYDAY=(\w+)/);
    return match ? `Weekly (${match[1]})` : rrule;
  }

  add(): void {
    const name = this.mealName().trim();
    if (!name) return;
    this.addError.set(false);
    this.habitsService
      .create({
        meal_name: name,
        slot: this.slot(),
        recurrence_rule: buildRrule(this.recurrence(), this.weeklyDay()),
      })
      .subscribe({
        next: () => { this.mealName.set(''); },
        error: () => this.addError.set(true),
      });
  }

  remove(id: string): void {
    this.habitsService.delete(id).subscribe();
  }

  save(): void {
    this.state.setMealHabits(this.habitsService.habits());
    this.complete.emit();
  }
}
