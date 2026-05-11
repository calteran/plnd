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

// Visual order of day pills: M T W T F S S (Mon–Sun, with Sun last).
// Bit 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat.
interface DayPill {
  bit: number;
  label: string;
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

// Mode is a user-level binary: every card in a user's setup is the same mode.
// 'dow'   → days_bitmask drives resolution; cycle_bitmask is unused (0).
// 'cycle' → cycle_bitmask drives resolution; days_bitmask is unused (0). All
//           cycle cards share the substep-level cycleLength + anchorDate.
type Mode = 'dow' | 'cycle';

// Default starting cycle length when the user first enters cycle mode.
// 7 anchors continuity with the 7-day mode they just left; the user adjusts
// up (e.g. 14 for an alternating-week rota) or down (e.g. 4 for 2-on-2-off).
const DEFAULT_CYCLE_LENGTH = 7;

// Mirrors the API's MAX_CYCLE_LENGTH guard against i32 sign-bit overflow:
// (1 << 31) - 1 wraps because bit 31 is the sign bit, so 30 is the safe cap.
const MAX_CYCLE_LENGTH = 30;

interface DraftMeal {
  localId: string;           // always set (crypto.randomUUID())
  id: string | null;         // null until saved to server
  name: string;
  preferred_time: string;    // "HH:MM" for <input type="time">
  tolerance_minutes: number;
  sort_order: number;
}

// Per-card state. Mode-level concerns (is_cycle / cycle_length / anchor_date)
// live on the component, not the card — every card shares the same mode.
interface ScheduleCard {
  localId: string;
  id: string | null;
  name: string;
  days_bitmask: number;     // active in 'dow' mode; 0 in 'cycle' mode
  cycle_bitmask: number;    // active in 'cycle' mode; 0 in 'dow' mode
  wake_time: string;
  sleep_time: string;
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

function blankCard(overrides: Partial<ScheduleCard> = {}): ScheduleCard {
  return {
    localId: crypto.randomUUID(),
    id: null,
    name: '',
    days_bitmask: 0,
    cycle_bitmask: 0,
    wake_time: '07:00',
    sleep_time: '22:00',
    showRemoveHint: false,
    meals: defaultDraftMeals(),
    ...overrides,
  };
}

function defaultDOWCards(): ScheduleCard[] {
  return [
    blankCard({ name: 'Weekdays', days_bitmask: 62, wake_time: '07:00', sleep_time: '22:00' }), // Mon–Fri: bits 1–5
    blankCard({ name: 'Weekends', days_bitmask: 65, wake_time: '08:00', sleep_time: '23:00' }), // Sat+Sun: bits 0+6
  ];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
    cycle_bitmask: r.cycle_bitmask,
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

      <!-- Mode-level cycle parameters (rendered once when in cycle mode) -->
      @if (mode() === 'cycle') {
        <div class="cycle-fields">
          <label class="cycle-field-label">
            <span>Cycle length (days)</span>
            <input
              type="number"
              class="cycle-input"
              min="1"
              [attr.max]="MAX_CYCLE_LENGTH"
              [value]="cycleLength() ?? ''"
              (change)="setCycleLength(+$any($event.target).value)"
              aria-label="Cycle length in days"
              required
            />
          </label>
          <label class="cycle-field-label">
            <span>Anchor date</span>
            <input
              type="date"
              class="cycle-input"
              [value]="anchorDate() ?? ''"
              (change)="anchorDate.set($any($event.target).value || null)"
              aria-label="Cycle anchor date"
              required
            />
          </label>
        </div>
      }

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
              [class.remove-btn--disabled]="hasClaimedPositions(card)"
              [attr.aria-disabled]="hasClaimedPositions(card) ? 'true' : null"
              [attr.disabled]="hasClaimedPositions(card) ? '' : null"
              (click)="onRemoveClick(cardIdx)"
              [attr.aria-label]="'Remove ' + card.name"
            >✕</button>
          </div>

          @if (card.showRemoveHint) {
            <p class="remove-hint">{{ removeHintText() }}</p>
          }

          <!-- Day / position pills -->
          @if (mode() === 'dow') {
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
            @if (cycleLength()) {
              <div class="day-row">
                @for (n of cyclePills(cycleLength()!); track n) {
                  <button
                    type="button"
                    class="day-pill"
                    [class.day-pill--active]="isCycleDaySelected(card.cycle_bitmask, n)"
                    (click)="toggleCycleDay(cardIdx, n)"
                    [attr.aria-label]="'Cycle position ' + n"
                    [attr.aria-pressed]="isCycleDaySelected(card.cycle_bitmask, n)"
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

        </div>
      }

      <!-- Add day type / mode switch -->
      <button
        type="button"
        class="add-link"
        (click)="addCard()"
      >+ Add day type</button>
      @if (mode() === 'dow') {
        <button
          type="button"
          class="add-link"
          (click)="enterCycleMode()"
        >Switch to rotating schedule</button>
      } @else {
        <button
          type="button"
          class="add-link"
          (click)="enterDOWMode()"
        >Switch to weekday schedule</button>
      }

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

    .cycle-fields {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      padding: 12px 14px;
      border: 1.5px dashed var(--color-accent-border);
      border-radius: 8px;
      background: var(--color-surface-base);
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

  readonly mode = signal<Mode>('dow');
  readonly cycleLength = signal<number | null>(null);
  readonly anchorDate = signal<string | null>(null);

  readonly cards = signal<ScheduleCard[]>([]);
  readonly saveError = signal(false);
  readonly deleteError = signal(false);
  readonly validationError = signal('');
  readonly isSaving = signal(false);

  private removeHintTimer: ReturnType<typeof setTimeout> | null = null;

  readonly dayPills = DAY_PILLS;
  readonly MAX_CYCLE_LENGTH = MAX_CYCLE_LENGTH;

  private readonly DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  ngOnInit(): void {
    const stored = this.stateService.dayTypes();
    // Use in-memory state when available; fall back to server (e.g. after page refresh)
    // so returning users get records with IDs — save() can then UPDATE rather than CREATE,
    // avoiding a bitmask-overlap 422 on already-created records.
    const types$ = stored.length > 0
      ? of(stored)
      : this.dayTypesService.list();

    types$.pipe(
      switchMap(types =>
        types.length === 0
          ? of(null)
          : forkJoin(types.map(dt =>
              this.dayTypesService.listMeals(dt.id).pipe(
                map(meals => ({ dt, meals }))
              )
            ))
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      if (result === null) {
        this.enterDOWMode();
      } else {
        const firstCycle = result.find(({ dt }) => dt.is_cycle)?.dt;
        if (firstCycle) {
          this.mode.set('cycle');
          this.cycleLength.set(firstCycle.cycle_length);
          this.anchorDate.set(firstCycle.anchor_date);
        } else {
          this.mode.set('dow');
          this.cycleLength.set(null);
          this.anchorDate.set(null);
        }
        this.cards.set(result.map(({ dt, meals }) => ({
          ...responseToCard(dt),
          meals: meals.map(mealToDraft),
        })));
      }
    });
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

  /** Claim a weekday for this card; steal it from whichever DOW card currently owns it. */
  toggleDay(cardIndex: number, bit: number): void {
    if (this.mode() !== 'dow') return;
    const bitValue = 1 << bit;
    const card = this.cards()[cardIndex];
    if (!card || (card.days_bitmask & bitValue) !== 0) return;

    this.cards.update(list =>
      list.map((c, i) => {
        if (i === cardIndex) return { ...c, days_bitmask: c.days_bitmask | bitValue };
        if ((c.days_bitmask & bitValue) !== 0) {
          return { ...c, days_bitmask: c.days_bitmask & ~bitValue };
        }
        return c;
      })
    );
  }

  /** Claim a cycle position for this card; steal it from whichever cycle card currently owns it. */
  toggleCycleDay(cardIndex: number, dayNumber: number): void {
    if (this.mode() !== 'cycle') return;
    const bitValue = 1 << (dayNumber - 1);
    const card = this.cards()[cardIndex];
    if (!card || (card.cycle_bitmask & bitValue) !== 0) return;

    this.cards.update(list =>
      list.map((c, i) => {
        if (i === cardIndex) return { ...c, cycle_bitmask: c.cycle_bitmask | bitValue };
        if ((c.cycle_bitmask & bitValue) !== 0) {
          return { ...c, cycle_bitmask: c.cycle_bitmask & ~bitValue };
        }
        return c;
      })
    );
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

  /** True when removing this card would leave its claimed positions/days unassigned. */
  hasClaimedPositions(card: ScheduleCard): boolean {
    return this.mode() === 'dow' ? card.days_bitmask !== 0 : card.cycle_bitmask !== 0;
  }

  removeHintText(): string {
    return this.mode() === 'dow'
      ? 'Uncheck all days before removing this type'
      : 'Reassign this card\'s cycle positions before removing';
  }

  onRemoveClick(index: number): void {
    const card = this.cards()[index];
    if (this.hasClaimedPositions(card)) {
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
    this.cards.update(list => [...list, blankCard()]);
  }

  /** Switch to cycle mode. Wipes existing cards — per spec, mode is binary and we
   *  don't carry per-card state across the boundary. Top card claims every position. */
  enterCycleMode(): void {
    this.mode.set('cycle');
    this.cycleLength.set(DEFAULT_CYCLE_LENGTH);
    this.anchorDate.set(todayIso());
    const fullMask = (1 << DEFAULT_CYCLE_LENGTH) - 1;
    this.cards.set([blankCard({ cycle_bitmask: fullMask })]);
    this.validationError.set('');
  }

  /** Switch to DOW mode. Wipes existing cards and restores the default two-card setup. */
  enterDOWMode(): void {
    this.mode.set('dow');
    this.cycleLength.set(null);
    this.anchorDate.set(null);
    this.cards.set(defaultDOWCards());
    this.validationError.set('');
  }

  /** Update the cycle length. Bits at or beyond the new length are masked off every
   *  card; any newly-introduced positions are claimed by the top card so coverage
   *  remains complete after the change. */
  setCycleLength(n: number): void {
    if (this.mode() !== 'cycle') return;
    const clamped = Math.max(1, Math.min(MAX_CYCLE_LENGTH, Math.floor(n)));
    this.cycleLength.set(clamped);
    const lowMask = (1 << clamped) - 1;
    this.cards.update(list =>
      list.map((c, i) => {
        const trimmed = c.cycle_bitmask & lowMask;
        if (i === 0) {
          const claimedByOthers = list
            .filter((_, j) => j !== 0)
            .reduce((m, x) => m | (x.cycle_bitmask & lowMask), 0);
          return { ...c, cycle_bitmask: lowMask & ~claimedByOthers };
        }
        return { ...c, cycle_bitmask: trimmed };
      })
    );
  }

  save(): void {
    if (this.isSaving()) return;

    this.saveError.set(false);
    this.validationError.set('');

    const isCycle = this.mode() === 'cycle';

    if (!isCycle) {
      const missing = this.cards().filter(c => c.days_bitmask === 0);
      if (missing.length > 0) {
        this.validationError.set('All day types must have at least one day assigned.');
        return;
      }
    } else {
      const length = this.cycleLength();
      const anchor = this.anchorDate();
      if (!length || length < 1 || !anchor) {
        this.validationError.set('Cycle day types must have a cycle length and start date.');
        return;
      }
      const fullMask = (1 << length) - 1;
      const missingPositions = this.cards().filter(c => c.cycle_bitmask === 0);
      if (missingPositions.length > 0) {
        this.validationError.set('All cycle day types must claim at least one position.');
        return;
      }
      const combined = this.cards().reduce((m, c) => m | c.cycle_bitmask, 0);
      if (combined !== fullMask) {
        this.validationError.set('Cycle positions must cover every day in the cycle.');
        return;
      }
    }

    const length = this.cycleLength();
    const anchor = this.anchorDate();

    const requests = this.cards().map(card => {
      const req = {
        name: card.name,
        days_bitmask: isCycle ? 0 : card.days_bitmask,
        cycle_bitmask: isCycle ? card.cycle_bitmask : 0,
        wake_time: card.wake_time,
        sleep_time: card.sleep_time,
        is_cycle: isCycle,
        cycle_length: isCycle ? length : null,
        anchor_date: isCycle ? anchor : null,
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
