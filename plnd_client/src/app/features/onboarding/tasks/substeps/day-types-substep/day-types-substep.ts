import {
  Component,
  DestroyRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of, switchMap, map } from 'rxjs';
import { DayTypesService } from '../../../../../core/services/day-types.service';
import { DayTypeResponse } from '../../../../../core/models/day-type';
import { MealPatternEntry } from '../../../../../core/models/meal-pattern';
import { OnboardingStateService } from '../../../onboarding-state.service';

// Visual order of day pills: M T W T F S S (Mon–Sun, with Sun last)
// Indices into the days array where days[i].bit maps to a bitmask bit.
// Bit 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
interface DayPill {
  bit: number;   // bitmask bit index (0=Sun … 6=Sat)
  label: string; // single-letter display label
}

const DAY_PILLS: DayPill[] = [
  { bit: 1, label: 'M' },
  { bit: 2, label: 'T' },
  { bit: 3, label: 'W' },
  { bit: 4, label: 'T' },
  { bit: 5, label: 'F' },
  { bit: 6, label: 'S' },
  { bit: 0, label: 'S' },
];

interface DraftMeal {
  localId: string;           // always set (crypto.randomUUID())
  id: string | null;         // null until saved to server
  name: string;
  preferred_time: string;    // "HH:MM" for <input type="time">
  tolerance_minutes: number;
  sort_order: number;
}

interface ScheduleCard {
  localId: string;
  id: string | null;
  name: string;
  days_bitmask: number;
  wake_time: string;
  sleep_time: string;
  is_cycle: boolean;
  cycle_length: number | null;
  anchor_date: string | null;
  showRemoveHint: boolean;
  meals: DraftMeal[];
}

function defaultDraftMeals(): DraftMeal[] {
  return [
    { localId: crypto.randomUUID(), id: null, name: 'Breakfast', preferred_time: '08:00', tolerance_minutes: 30, sort_order: 0 },
    { localId: crypto.randomUUID(), id: null, name: 'Lunch',     preferred_time: '12:00', tolerance_minutes: 30, sort_order: 1 },
    { localId: crypto.randomUUID(), id: null, name: 'Dinner',    preferred_time: '18:00', tolerance_minutes: 30, sort_order: 2 },
  ];
}

function mealToDraft(m: MealPatternEntry): DraftMeal {
  return {
    localId: crypto.randomUUID(),
    id: m.id,
    name: m.name,
    preferred_time: m.preferred_time.slice(0, 5), // "HH:MM:SS" → "HH:MM"
    tolerance_minutes: m.tolerance_minutes,
    sort_order: m.sort_order,
  };
}

function defaultCards(): ScheduleCard[] {
  return [
    {
      localId: crypto.randomUUID(),
      id: null,
      name: 'Weekdays',
      days_bitmask: 62, // Mon–Fri: bits 1–5
      wake_time: '07:00',
      sleep_time: '22:00',
      is_cycle: false,
      cycle_length: null,
      anchor_date: null,
      showRemoveHint: false,
      meals: defaultDraftMeals(),
    },
    {
      localId: crypto.randomUUID(),
      id: null,
      name: 'Weekends',
      days_bitmask: 65, // Sat+Sun: bits 0+6
      wake_time: '08:00',
      sleep_time: '23:00',
      is_cycle: false,
      cycle_length: null,
      anchor_date: null,
      showRemoveHint: false,
      meals: defaultDraftMeals(),
    },
  ];
}

function responseToCard(r: DayTypeResponse): ScheduleCard {
  return {
    localId: crypto.randomUUID(),
    id: r.id,
    name: r.name,
    // Trim seconds from "HH:MM:SS" → "HH:MM" for <input type="time">
    wake_time: r.wake_time.length > 5 ? r.wake_time.slice(0, 5) : r.wake_time,
    sleep_time: r.sleep_time.length > 5 ? r.sleep_time.slice(0, 5) : r.sleep_time,
    days_bitmask: r.days_bitmask,
    is_cycle: r.is_cycle,
    cycle_length: r.cycle_length,
    anchor_date: r.anchor_date,
    showRemoveHint: false,
    meals: (r.meals ?? []).map(mealToDraft),
  };
}

@Component({
  selector: 'app-day-types-substep',
  standalone: true,
  imports: [],
  template: `
    <div class="day-types-substep">

      @for (card of cards(); track card.localId; let cardIdx = $index) {
        <div class="schedule-card">

          <!-- Card header: editable name + remove button -->
          <div class="card-header">
            <input
              type="text"
              class="card-name-input"
              placeholder="Schedule name"
              [value]="card.name"
              (input)="updateCard(cardIdx, { name: $any($event.target).value })"
              aria-label="Day type name"
            />
            <button
              type="button"
              class="remove-btn"
              [class.remove-btn--disabled]="card.days_bitmask !== 0"
              [attr.aria-disabled]="card.days_bitmask !== 0 ? 'true' : null"
              [attr.disabled]="card.days_bitmask !== 0 ? '' : null"
              (click)="onRemoveClick(cardIdx)"
              [attr.aria-label]="'Remove ' + card.name"
            >✕</button>
          </div>

          @if (card.showRemoveHint) {
            <p class="remove-hint">Uncheck all days before removing this type</p>
          }

          <!-- Day pills -->
          @if (!card.is_cycle) {
            <div class="day-row">
              @for (day of dayPills; track day.bit) {
                <button
                  type="button"
                  class="day-pill"
                  [class.day-pill--active]="isDaySelected(card.days_bitmask, day.bit)"
                  (click)="toggleDay(cardIdx, day.bit)"
                  [attr.aria-label]="dayLabel(day.bit)"
                  [attr.aria-pressed]="isDaySelected(card.days_bitmask, day.bit)"
                >{{ day.label }}</button>
              }
            </div>
          } @else {
            <!-- Cycle mode: numbered day pills 1…N -->
            @if (card.cycle_length && card.cycle_length > 0) {
              <div class="day-row">
                @for (n of cyclePills(card.cycle_length); track n) {
                  <button
                    type="button"
                    class="day-pill"
                    [class.day-pill--active]="isCycleDaySelected(card.days_bitmask, n)"
                    (click)="toggleCycleDay(cardIdx, n)"
                    [attr.aria-label]="'Day ' + n"
                    [attr.aria-pressed]="isCycleDaySelected(card.days_bitmask, n)"
                  >{{ n }}</button>
                }
              </div>
            }
          }

          <!-- Time inputs -->
          <div class="time-row">
            <label class="time-label">
              <span>Wake</span>
              <input
                type="time"
                class="time-input"
                [value]="card.wake_time"
                (change)="updateCard(cardIdx, { wake_time: $any($event.target).value })"
                required
              />
            </label>
            <label class="time-label">
              <span>Sleep</span>
              <input
                type="time"
                class="time-input"
                [value]="card.sleep_time"
                (change)="updateCard(cardIdx, { sleep_time: $any($event.target).value })"
                required
              />
            </label>
          </div>

          <!-- Meals for this day type -->
          <div class="meal-section">
            <p class="meal-section-title">Meals</p>
            @for (meal of card.meals; track meal.localId) {
              <div class="meal-row">
                <input
                  type="text"
                  class="meal-name-input"
                  placeholder="Meal name"
                  [value]="meal.name"
                  (input)="updateMeal(cardIdx, meal.localId, { name: $any($event.target).value })"
                  aria-label="Meal name"
                />
                <input
                  type="time"
                  class="meal-time-input"
                  [value]="meal.preferred_time"
                  (change)="updateMeal(cardIdx, meal.localId, { preferred_time: $any($event.target).value })"
                  aria-label="Preferred time for {{ meal.name }}"
                />
                <input
                  type="number"
                  class="meal-tolerance-input"
                  min="0"
                  max="120"
                  [value]="meal.tolerance_minutes"
                  (change)="updateMeal(cardIdx, meal.localId, { tolerance_minutes: +$any($event.target).value })"
                  aria-label="Tolerance (minutes) for {{ meal.name }}"
                  title="Window (±minutes)"
                />
                <button
                  type="button"
                  class="remove-meal-btn"
                  [attr.disabled]="card.meals.length <= 1 ? '' : null"
                  (click)="removeMeal(cardIdx, meal.localId)"
                  [attr.aria-label]="'Remove ' + meal.name"
                >✕</button>
              </div>
            }
            <button
              type="button"
              class="add-meal-btn"
              (click)="addMeal(cardIdx)"
            >+ Add meal</button>
          </div>

          <!-- Cycle mode fields (only shown for cycle cards) -->
          @if (card.is_cycle) {
            <div class="cycle-fields">
              <label class="cycle-field-label">
                <span>Cycle length (days)</span>
                <input
                  type="number"
                  class="cycle-input"
                  min="1"
                  [value]="card.cycle_length ?? ''"
                  (change)="updateCard(cardIdx, { cycle_length: +$any($event.target).value })"
                  required
                />
              </label>
              <label class="cycle-field-label">
                <span>Anchor date</span>
                <input
                  type="date"
                  class="cycle-input"
                  [value]="card.anchor_date ?? ''"
                  (change)="updateCard(cardIdx, { anchor_date: $any($event.target).value })"
                  required
                />
              </label>
            </div>
            <button
              type="button"
              class="cycle-toggle-link"
              (click)="disableCycleMode(cardIdx)"
            >Switch to 7-day week</button>
          }

        </div>
      }

      <!-- Add day type -->
      <button
        type="button"
        class="add-link"
        (click)="addCard()"
      >+ Add day type</button>
      <button
        type="button"
        class="add-link"
        (click)="addCycleCard()"
      >Non-7-day schedule?</button>

      <!-- Validation error -->
      @if (validationError()) {
        <p class="save-error">{{ validationError() }}</p>
      }

      <!-- Delete error -->
      @if (deleteError()) {
        <p class="save-error">Failed to remove day type. Please try again.</p>
      }

      <!-- Save error -->
      @if (saveError()) {
        <p class="save-error">Failed to save day types. Please try again.</p>
      }

      <!-- Save & Continue button -->
      <button
        type="button"
        class="save-btn"
        [disabled]="isSaving()"
        (click)="save()"
      >{{ isSaving() ? 'Saving…' : 'Save & Continue →' }}</button>

    </div>
  `,
  styles: [`
    .day-types-substep {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .schedule-card {
      border: 1.5px solid var(--color-accent-border);
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: var(--color-surface-white);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-name-input {
      flex: 1;
      border: 1.5px solid var(--color-accent-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 14px;
      font-weight: 700;
      color: var(--color-text-primary);
      outline: none;
    }

    .card-name-input:focus {
      border-color: var(--color-accent);
    }

    .remove-btn {
      background: none;
      border: 1.5px solid var(--color-btn-neutral-border);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 14px;
      cursor: pointer;
      color: var(--color-btn-neutral-text);
      transition: color 0.15s, border-color 0.15s;
    }

    .remove-btn:hover:not(.remove-btn--disabled) {
      color: var(--color-destructive);
      border-color: var(--color-destructive);
    }

    .remove-btn--disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }

    .remove-hint {
      font-size: 11px;
      color: var(--color-accent);
      margin: 0;
      padding: 4px 6px;
      background: var(--color-accent-light);
      border-radius: 4px;
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
      background: var(--color-surface-base);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      color: var(--color-text-body);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .day-pill--active {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-btn-accent-text);
    }

    .time-row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .time-label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
      font-weight: 700;
      color: var(--color-text-primary);
    }

    .time-input {
      border: 1.5px solid var(--color-accent-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 13px;
    }

    .cycle-toggle-link {
      background: none;
      border: none;
      padding: 0;
      font-size: 12px;
      color: var(--color-accent);
      cursor: pointer;
      text-decoration: underline;
      text-align: left;
    }

    .cycle-fields {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .cycle-field-label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
      font-weight: 700;
      color: var(--color-text-primary);
    }

    .cycle-input {
      border: 1.5px solid var(--color-accent-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 13px;
    }

    .add-link {
      background: none;
      border: none;
      padding: 4px 0;
      font-size: 13px;
      color: var(--color-accent);
      cursor: pointer;
      text-decoration: underline;
      text-align: left;
      font-weight: 600;
    }

    .save-error {
      color: var(--color-destructive);
      font-size: 12px;
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

    .save-btn:hover:not(:disabled) {
      filter: brightness(0.88);
    }

    .meal-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .meal-section-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--color-text-primary);
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .meal-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .meal-name-input {
      flex: 1;
      border: 1.5px solid var(--color-accent-border);
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 13px;
      color: var(--color-text-primary);
      outline: none;
    }

    .meal-name-input:focus {
      border-color: var(--color-accent);
    }

    .meal-time-input {
      border: 1.5px solid var(--color-accent-border);
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 13px;
    }

    .meal-tolerance-input {
      width: 56px;
      border: 1.5px solid var(--color-accent-border);
      border-radius: 6px;
      padding: 5px 6px;
      font-size: 13px;
      text-align: center;
    }

    .remove-meal-btn {
      background: none;
      border: 1.5px solid var(--color-btn-neutral-border);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
      color: var(--color-btn-neutral-text);
      transition: color 0.15s, border-color 0.15s;
    }

    .remove-meal-btn:hover:not(:disabled) {
      color: var(--color-destructive);
      border-color: var(--color-destructive);
    }

    .remove-meal-btn:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }

    .add-meal-btn {
      background: none;
      border: none;
      padding: 2px 0;
      font-size: 12px;
      color: var(--color-accent);
      cursor: pointer;
      text-decoration: underline;
      text-align: left;
      font-weight: 600;
    }
  `],
})
export class DayTypesSubstepComponent implements OnInit, OnDestroy {
  @Output() complete = new EventEmitter<void>();

  private readonly dayTypesService = inject(DayTypesService);
  private readonly stateService = inject(OnboardingStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cards = signal<ScheduleCard[]>([]);
  readonly saveError = signal(false);
  readonly deleteError = signal(false);
  readonly validationError = signal('');
  readonly isSaving = signal(false);

  private removeHintTimer: ReturnType<typeof setTimeout> | null = null;

  readonly dayPills = DAY_PILLS;

  private readonly DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  ngOnInit(): void {
    const stored = this.stateService.dayTypes();
    if (stored.length > 0) {
      this.cards.set(stored.map(responseToCard));
      stored.forEach((dt, idx) => {
        this.dayTypesService.listMeals(dt.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(meals => {
            this.updateCard(idx, { meals: meals.map(mealToDraft) });
          });
      });
    } else {
      this.cards.set(defaultCards());
    }
  }

  /** Update a single card's properties immutably. */
  updateCard(index: number, patch: Partial<ScheduleCard>): void {
    this.cards.update(list => {
      const updated = [...list];
      updated[index] = { ...updated[index], ...patch };
      return updated;
    });
  }

  addMeal(cardIndex: number): void {
    const card = this.cards()[cardIndex];
    const newMeal: DraftMeal = {
      localId: crypto.randomUUID(),
      id: null,
      name: '',
      preferred_time: '12:00',
      tolerance_minutes: 30,
      sort_order: card.meals.length,
    };
    this.updateCard(cardIndex, { meals: [...card.meals, newMeal] });
  }

  updateMeal(cardIndex: number, mealLocalId: string, patch: Partial<DraftMeal>): void {
    const card = this.cards()[cardIndex];
    const updatedMeals = card.meals.map(m =>
      m.localId === mealLocalId ? { ...m, ...patch } : m
    );
    this.updateCard(cardIndex, { meals: updatedMeals });
  }

  removeMeal(cardIndex: number, mealLocalId: string): void {
    const card = this.cards()[cardIndex];
    if (card.meals.length <= 1) return;
    this.updateCard(cardIndex, {
      meals: card.meals.filter(m => m.localId !== mealLocalId),
    });
  }

  /** Claim a calendar day for this card, moving it away from whichever card currently owns it. */
  toggleDay(cardIndex: number, bit: number): void {
    const bitValue = 1 << bit;
    const card = this.cards()[cardIndex];

    // No-op: day already belongs to this card, or card is in cycle mode.
    if (!card || card.is_cycle || (card.days_bitmask & bitValue) !== 0) return;

    this.cards.update(list =>
      list.map((c, i) => {
        if (i === cardIndex) return { ...c, days_bitmask: c.days_bitmask | bitValue };
        if (!c.is_cycle && (c.days_bitmask & bitValue) !== 0) {
          return { ...c, days_bitmask: c.days_bitmask & ~bitValue };
        }
        return c;
      })
    );
  }

  /** Toggle a numbered cycle day. Cycle days use bits 0…(N-1), day n uses bit (n-1). */
  toggleCycleDay(cardIndex: number, dayNumber: number): void {
    const card = this.cards()[cardIndex];
    const bit = dayNumber - 1;
    const newMask = card.days_bitmask ^ (1 << bit);
    this.updateCard(cardIndex, { days_bitmask: newMask });
  }

  isDaySelected(mask: number, bit: number): boolean {
    return (mask & (1 << bit)) !== 0;
  }

  isCycleDaySelected(mask: number, dayNumber: number): boolean {
    return (mask & (1 << (dayNumber - 1))) !== 0;
  }

  dayLabel(bit: number): string {
    return this.DAY_NAMES[bit] ?? `Day ${bit}`;
  }

  cyclePills(length: number): number[] {
    return Array.from({ length }, (_, i) => i + 1);
  }

  onRemoveClick(index: number): void {
    const card = this.cards()[index];
    if (card.days_bitmask !== 0) {
      // Show inline hint, auto-dismiss after 3 seconds
      this.updateCard(index, { showRemoveHint: true });
      if (this.removeHintTimer) clearTimeout(this.removeHintTimer);
      this.removeHintTimer = setTimeout(() => {
        this.updateCard(index, { showRemoveHint: false });
        this.removeHintTimer = null;
      }, 3000);
    } else if (card.id) {
      // Existing server record — delete before removing from local list
      this.deleteError.set(false);
      this.dayTypesService.delete(card.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.cards.update(list => list.filter((_, i) => i !== index));
          },
          error: () => {
            this.deleteError.set(true);
          },
        });
    } else {
      // Client-only card (never saved) — remove immediately
      this.cards.update(list => list.filter((_, i) => i !== index));
    }
  }

  ngOnDestroy(): void {
    if (this.removeHintTimer) clearTimeout(this.removeHintTimer);
  }

  addCard(): void {
    const blank: ScheduleCard = {
      localId: crypto.randomUUID(),
      id: null,
      name: '',
      days_bitmask: 0,
      wake_time: '07:00',
      sleep_time: '22:00',
      is_cycle: false,
      cycle_length: null,
      anchor_date: null,
      showRemoveHint: false,
      meals: defaultDraftMeals(),
    };
    this.cards.update(list => [...list, blank]);
  }

  addCycleCard(): void {
    const blank: ScheduleCard = {
      localId: crypto.randomUUID(),
      id: null,
      name: '',
      days_bitmask: 0,
      wake_time: '07:00',
      sleep_time: '22:00',
      is_cycle: true,
      cycle_length: 1,
      anchor_date: null,
      showRemoveHint: false,
      meals: defaultDraftMeals(),
    };
    this.cards.update(list => [...list, blank]);
  }

  disableCycleMode(index: number): void {
    this.updateCard(index, {
      is_cycle: false,
      cycle_length: null,
      anchor_date: null,
      days_bitmask: 0,
    });
  }

  save(): void {
    if (this.isSaving()) return;

    this.saveError.set(false);
    this.validationError.set('');

    // Validate 7-day cards
    const missing7Day = this.cards().filter(c => !c.is_cycle && c.days_bitmask === 0);
    // Validate cycle cards
    const missingCycle = this.cards().filter(c => c.is_cycle && (!c.cycle_length || c.cycle_length < 1 || !c.anchor_date));

    if (missing7Day.length > 0) {
      this.validationError.set('All day types must have at least one day assigned.');
      return;
    }
    if (missingCycle.length > 0) {
      this.validationError.set('Cycle day types must have a cycle length and start date.');
      return;
    }

    const requests = this.cards().map(card => {
      const req = {
        name: card.name,
        days_bitmask: card.days_bitmask,
        wake_time: card.wake_time,
        sleep_time: card.sleep_time,
        is_cycle: card.is_cycle,
        cycle_length: card.cycle_length,
        anchor_date: card.anchor_date,
      };
      if (card.id) {
        return this.dayTypesService.update(card.id, req);
      }
      return this.dayTypesService.create(req);
    });

    if (requests.length === 0) {
      this.stateService.setDayTypes([]);
      this.complete.emit();
      return;
    }

    this.isSaving.set(true);
    forkJoin(requests).pipe(
      switchMap(dayTypeResults => {
        const mealSaves = dayTypeResults.map((dt, idx) => {
          const card = this.cards()[idx];
          // Fetch current server meals so we catch removals (not just UI-tracked IDs).
          return this.dayTypesService.listMeals(dt.id).pipe(
            switchMap(serverMeals =>
              serverMeals.length > 0
                ? forkJoin(serverMeals.map(m => this.dayTypesService.deleteMeal(dt.id, m.id)))
                : of([] as void[])
            ),
            switchMap(() =>
              card.meals.length > 0
                ? forkJoin(card.meals.map((m, sort_order) =>
                    this.dayTypesService.createMeal(dt.id, {
                      name: m.name,
                      preferred_time: m.preferred_time,
                      tolerance_minutes: m.tolerance_minutes,
                      sort_order,
                    })
                  ))
                : of([] as MealPatternEntry[])
            ),
            map(meals => ({ ...dt, meals }) as DayTypeResponse),
          );
        });
        return mealSaves.length > 0 ? forkJoin(mealSaves) : of([] as DayTypeResponse[]);
      }),
    ).subscribe({
      next: (augmented) => {
        this.stateService.setDayTypes(augmented);
        this.isSaving.set(false);
        this.complete.emit();
      },
      error: () => {
        this.saveError.set(true);
        this.isSaving.set(false);
      },
    });
  }
}
