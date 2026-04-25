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
import { forkJoin } from 'rxjs';
import { ScheduleTypesService } from '../../../../../core/services/schedule-types.service';
import { ScheduleTypeResponse } from '../../../../../core/models/schedule-type';
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

interface ScheduleCard {
  localId: string;
  id: string | null;
  name: string;
  days_bitmask: number;
  wake_time: string;
  bed_time: string;
  is_cycle: boolean;
  cycle_length: number | null;
  anchor_date: string | null;
  showRemoveHint: boolean;
}

function defaultCards(): ScheduleCard[] {
  return [
    {
      localId: crypto.randomUUID(),
      id: null,
      name: 'Weekdays',
      days_bitmask: 62, // Mon–Fri: bits 1–5
      wake_time: '07:00',
      bed_time: '22:00',
      is_cycle: false,
      cycle_length: null,
      anchor_date: null,
      showRemoveHint: false,
    },
    {
      localId: crypto.randomUUID(),
      id: null,
      name: 'Weekends',
      days_bitmask: 65, // Sat+Sun: bits 0+6
      wake_time: '08:00',
      bed_time: '23:00',
      is_cycle: false,
      cycle_length: null,
      anchor_date: null,
      showRemoveHint: false,
    },
  ];
}

function responseToCard(r: ScheduleTypeResponse): ScheduleCard {
  return {
    localId: crypto.randomUUID(),
    id: r.id,
    name: r.name,
    // Trim seconds from "HH:MM:SS" → "HH:MM" for <input type="time">
    wake_time: r.wake_time.length > 5 ? r.wake_time.slice(0, 5) : r.wake_time,
    bed_time: r.bed_time.length > 5 ? r.bed_time.slice(0, 5) : r.bed_time,
    days_bitmask: r.days_bitmask,
    is_cycle: r.is_cycle,
    cycle_length: r.cycle_length,
    anchor_date: r.anchor_date,
    showRemoveHint: false,
  };
}

@Component({
  selector: 'app-schedule-types-substep',
  standalone: true,
  imports: [],
  template: `
    <div class="schedule-types-substep">

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
              aria-label="Schedule type name"
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
              <span>Bed</span>
              <input
                type="time"
                class="time-input"
                [value]="card.bed_time"
                (change)="updateCard(cardIdx, { bed_time: $any($event.target).value })"
                required
              />
            </label>
          </div>

          <!-- Cycle mode toggle -->
          @if (!card.is_cycle) {
            <button
              type="button"
              class="cycle-toggle-link"
              (click)="enableCycleMode(cardIdx)"
            >Non-7-day schedule?</button>
          } @else {
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

      <!-- Add schedule type -->
      <button
        type="button"
        class="add-link"
        (click)="addCard()"
      >+ Add schedule type</button>

      <!-- Validation error -->
      @if (validationError()) {
        <p class="save-error">{{ validationError() }}</p>
      }

      <!-- Delete error -->
      @if (deleteError()) {
        <p class="save-error">Failed to remove schedule type. Please try again.</p>
      }

      <!-- Save error -->
      @if (saveError()) {
        <p class="save-error">Failed to save schedule types. Please try again.</p>
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
    .schedule-types-substep {
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
  `],
})
export class ScheduleTypesSubstepComponent implements OnInit, OnDestroy {
  @Output() complete = new EventEmitter<void>();

  private readonly scheduleTypesService = inject(ScheduleTypesService);
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
    const stored = this.stateService.scheduleTypes();
    if (stored.length > 0) {
      this.cards.set(stored.map(responseToCard));
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

  /** Claim a calendar day for this card, moving it away from whichever card currently owns it. */
  toggleDay(cardIndex: number, bit: number): void {
    const bitValue = 1 << bit;
    const card = this.cards()[cardIndex];

    // No-op: day already belongs to this card — days cannot be deselected.
    if ((card.days_bitmask & bitValue) !== 0) return;

    this.cards.update(list =>
      list.map((c, i) => {
        if (i === cardIndex) return { ...c, days_bitmask: c.days_bitmask | bitValue };
        if (!c.is_cycle) return { ...c, days_bitmask: c.days_bitmask & ~bitValue };
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
      this.scheduleTypesService.delete(card.id)
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
      bed_time: '22:00',
      is_cycle: false,
      cycle_length: null,
      anchor_date: null,
      showRemoveHint: false,
    };
    this.cards.update(list => [...list, blank]);
  }

  enableCycleMode(index: number): void {
    this.updateCard(index, {
      is_cycle: true,
      cycle_length: 1,
      anchor_date: null,
      days_bitmask: 0,
    });
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
      this.validationError.set('All schedule types must have at least one day assigned.');
      return;
    }
    if (missingCycle.length > 0) {
      this.validationError.set('Cycle schedule types must have a cycle length and start date.');
      return;
    }

    const requests = this.cards().map(card => {
      const req = {
        name: card.name,
        days_bitmask: card.days_bitmask,
        wake_time: card.wake_time,
        bed_time: card.bed_time,
        is_cycle: card.is_cycle,
        cycle_length: card.cycle_length,
        anchor_date: card.anchor_date,
      };
      if (card.id) {
        return this.scheduleTypesService.update(card.id, req);
      }
      return this.scheduleTypesService.create(req);
    });

    if (requests.length === 0) {
      this.stateService.setScheduleTypes([]);
      this.complete.emit();
      return;
    }

    this.isSaving.set(true);
    forkJoin(requests).subscribe({
      next: (responses) => {
        this.stateService.setScheduleTypes(responses);
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
