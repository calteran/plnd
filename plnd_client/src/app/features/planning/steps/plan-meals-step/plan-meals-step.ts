import { Component, computed, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import {
  MealSlot, PlannedMeal, getMockSuggestion, MOCK_MEAL_SUGGESTIONS, SKIP_SENTINEL,
  STANDARD_MEAL_SLOTS,
} from '../../../../core/models/week-plan';
const SLOT_LABELS: Partial<Record<MealSlot, string>> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
};

@Component({
  selector: 'app-plan-meals-step',
  standalone: true,
  imports: [],
  template: `
    <div class="plan-meals-wrapper">
      <div class="meals-grid" [style.grid-template-columns]="gridColumns()">

        <!-- Header row: empty corner + one day header per column -->
        <div></div>
        @for (day of horizonDays(); track day) {
          <div class="cell-day-header">
            <span class="day-name">{{ formatDayName(day) }}</span>
            <span class="day-date">{{ formatDayDate(day) }}</span>
          </div>
        }

        <!-- One row per meal slot -->
        @for (slot of slots; track slot) {
          <div class="cell-slot-label">
            <span class="slot-lbl">{{ slotLabel(slot) }}</span>
          </div>
          @for (day of horizonDays(); track day) {
            <div class="gc"
                 [class.custom-g]="isCustom(day, slot)"
                 [class.skipped-g]="isSkipped(day, slot)"
                 [class.gc-editing]="isCellEditing(day, slot)">

              @if (isSkipped(day, slot)) {
                <span class="gc-text skip-t">— skipped</span>
                <div class="gc-actions">
                  <button class="gc-undo" type="button"
                          (click)="undoSkip(day, slot)">undo</button>
                </div>

              } @else if (isCellEditing(day, slot)) {
                <input #mealInput
                       class="mock-input"
                       type="text"
                       [value]="editingValue()"
                       (keydown.enter)="confirmEdit(day, slot, mealInput.value)"
                       (keydown.escape)="cancelEdit()"
                       (blur)="cancelEdit()">
                <span class="input-hint">Enter · Esc to cancel</span>

              } @else if (isCustom(day, slot)) {
                <button class="gc-x" type="button"
                        data-tip="Clear meal"
                        (click)="clearCustom(day, slot)">×</button>
                <span class="gc-text custom-t">{{ getMeal(day, slot)?.title ?? '' }}</span>
                <div class="gc-actions">
                  <button class="gc-edit-custom" type="button"
                          (click)="startEdit(day, slot)">✏️ edit</button>
                </div>

              } @else {
                <button class="gc-x" type="button"
                        data-tip="Skip this meal"
                        (click)="skipSlot(day, slot)">×</button>
                <span class="gc-text">{{ getSuggestion(day, slot) }}</span>
                <div class="gc-actions">
                  <button class="gc-pick" type="button"
                          data-tip="Pick your own meal"
                          (click)="startEdit(day, slot)">✏️</button>
                  <button class="gc-suggest" type="button"
                          data-tip="Try a different suggestion"
                          (click)="reSuggest(day, slot)">🔀</button>
                </div>
              }

            </div>
          }
        }

      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .plan-meals-wrapper { overflow-x: auto; padding-bottom: 8px; }

    .meals-grid {
      display: grid;
      gap: 5px;
      min-width: 360px;
    }

    /* ── Day column headers — accordion band style ── */
    .cell-day-header {
      background: var(--color-surface-warm);
      border-bottom: 2px solid var(--color-border-meal);
      border-radius: 8px 8px 0 0;
      padding: 7px 8px 6px;
      text-align: center;
    }
    .day-name {
      font-size: 11px; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.07em; color: var(--color-text-primary); display: block;
    }
    .day-date {
      font-size: 9px; color: var(--color-text-muted); display: block; margin-top: 1px;
    }

    /* ── Slot row labels ── */
    .cell-slot-label {
      display: flex; align-items: center; justify-content: flex-end; padding-right: 8px;
    }
    .slot-lbl {
      font-size: 9px; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--color-text-muted); text-align: right;
    }

    /* ── CSS-only tooltip ── */
    [data-tip] { position: relative; }
    [data-tip]:hover::after {
      content: attr(data-tip);
      position: absolute; bottom: calc(100% + 5px); left: 50%; transform: translateX(-50%);
      background: #1a1a18; color: #fff; font-size: 10px; white-space: nowrap;
      padding: 3px 7px; border-radius: 4px; pointer-events: none; z-index: 10;
    }
    [data-tip]:hover::before {
      content: ''; position: absolute; bottom: calc(100% + 1px);
      left: 50%; transform: translateX(-50%);
      border: 4px solid transparent; border-top-color: #1a1a18;
      pointer-events: none; z-index: 10;
    }

    /* ── Cell shell ── */
    .gc {
      background: var(--color-surface-white);
      border: 1px solid var(--color-border-row);
      border-radius: 7px;
      padding: 7px 8px 6px;
      display: flex; flex-direction: column; gap: 0;
      min-height: 68px; position: relative; box-sizing: border-box;
    }
    .gc.custom-g  { border-color: var(--color-accent-border); background: var(--color-accent-light); }
    .gc.skipped-g { background: var(--color-surface-base); opacity: 0.45; }
    .gc.gc-editing {
      border-color: var(--color-accent-border);
      box-shadow: 0 0 0 2px var(--color-accent-light);
    }

    /* Skip / clear corner button */
    .gc-x {
      position: absolute; top: 4px; right: 5px;
      background: none; border: none; padding: 0;
      font-size: 11px; color: var(--color-text-muted);
      cursor: pointer; opacity: 0.25; line-height: 1;
      width: 15px; height: 15px; display: flex; align-items: center; justify-content: center;
      border-radius: 3px;
    }
    .gc-x:hover { opacity: 0.6; }

    /* Meal suggestion / custom text */
    .gc-text {
      font-size: 11px; color: var(--color-text-body); font-style: italic; opacity: 0.75;
      line-height: 1.3; flex: 1; padding-right: 14px; margin-bottom: 5px;
    }
    .gc-text.custom-t {
      color: var(--color-accent-dark); font-weight: 600; font-style: normal; opacity: 1;
    }
    .gc-text.skip-t {
      color: var(--color-text-muted); font-size: 10px; font-style: italic;
    }

    /* Ghost action buttons row */
    .gc-actions { display: flex; gap: 4px; }
    .gc-pick,
    .gc-suggest {
      flex: 1;
      background: transparent;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 5px; padding: 3px 0;
      font-size: 12px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--color-text-muted);
      transition: background 0.12s, border-color 0.12s;
    }
    .gc-pick:hover {
      background: var(--color-accent-light);
      border-color: var(--color-accent-border);
    }
    .gc-suggest:hover {
      background: var(--color-surface-base);
      border-color: var(--color-border-row);
    }

    /* Custom meal edit button */
    .gc-edit-custom {
      background: transparent; border: 1px solid rgba(217, 119, 6, 0.2);
      border-radius: 5px; padding: 3px 7px;
      font-size: 10px; color: var(--color-accent-dark);
      cursor: pointer; opacity: 0.75; align-self: flex-end;
      transition: opacity 0.1s;
    }
    .gc-edit-custom:hover { opacity: 1; }

    /* Undo skip */
    .gc-undo {
      font-size: 9px; color: var(--color-text-muted); background: none; border: none;
      text-decoration: underline dotted; cursor: pointer; padding: 0; align-self: flex-end;
    }

    /* Inline edit input */
    .mock-input {
      font-size: 12px; color: var(--color-text-primary);
      border: none; border-bottom: 1.5px solid var(--color-accent-border);
      outline: none; padding: 1px 0; background: transparent;
      width: 100%; font-family: inherit; flex: 1; margin-bottom: 4px;
    }
    .input-hint { font-size: 9px; color: var(--color-text-muted); font-style: italic; }
  `],
})
export class PlanMealsStepComponent {
  private readonly weekPlanService = inject(WeekPlanService);

  @ViewChild('mealInput') private mealInput?: ElementRef<HTMLInputElement>;

  readonly slots = STANDARD_MEAL_SLOTS;
  readonly horizonDays = computed(() => this.weekPlanService.horizonDays());
  readonly gridColumns = computed(
    () => `68px repeat(${this.horizonDays().length}, 1fr)`,
  );

  /** Tracks which cell (if any) has its inline text input open. */
  readonly editingCell = signal<{ date: string; slot: MealSlot } | null>(null);
  /** Current value in the open text input. */
  readonly editingValue = signal('');
  /** Per-cell offset for cycling through mock suggestions without persisting them. */
  private readonly suggestOffsets = signal<Record<string, number>>({});

  // ── Formatters ────────────────────────────────────────────

  formatDayName(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
  }

  formatDayDate(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });
  }

  slotLabel(slot: MealSlot): string {
    return SLOT_LABELS[slot] ?? slot;
  }

  // ── Cell state queries ─────────────────────────────────────

  getMeal(date: string, slot: MealSlot): PlannedMeal | undefined {
    return this.weekPlanService.scheduledMeals()[date]?.[slot];
  }

  isSkipped(date: string, slot: MealSlot): boolean {
    return this.getMeal(date, slot)?.title === SKIP_SENTINEL;
  }

  isCustom(date: string, slot: MealSlot): boolean {
    return this.getMeal(date, slot)?.type === 'user_meal';
  }

  isCellEditing(date: string, slot: MealSlot): boolean {
    const e = this.editingCell();
    return e?.date === date && e?.slot === slot;
  }

  /**
   * Returns the current suggestion for a pending cell. Prefers the persisted mock
   * title (set when the user cycles with 🔀); falls back to the deterministic
   * suggestion rotated by the local offset signal.
   */
  getSuggestion(date: string, slot: MealSlot): string {
    const stored = this.getMeal(date, slot);
    if (stored?.type === 'mock') return stored.title;
    const key = `${date}:${slot}`;
    const offset = this.suggestOffsets()[key] ?? 0;
    const baseIdx = MOCK_MEAL_SUGGESTIONS.indexOf(getMockSuggestion(date, slot));
    return MOCK_MEAL_SUGGESTIONS[(baseIdx + offset) % MOCK_MEAL_SUGGESTIONS.length];
  }

  // ── Actions ───────────────────────────────────────────────

  startEdit(date: string, slot: MealSlot): void {
    const existing = this.getMeal(date, slot);
    this.editingValue.set(existing?.type === 'user_meal' ? existing.title : '');
    this.editingCell.set({ date, slot });
    // Defer focus until Angular has rendered the input element.
    setTimeout(() => this.mealInput?.nativeElement.focus());
  }

  confirmEdit(date: string, slot: MealSlot, value: string): void {
    const trimmed = value.trim();
    if (trimmed) {
      this.weekPlanService.setMeal(date, slot, { type: 'user_meal', title: trimmed });
    }
    this.editingCell.set(null);
    this.editingValue.set('');
  }

  cancelEdit(): void {
    this.editingCell.set(null);
    this.editingValue.set('');
  }

  skipSlot(date: string, slot: MealSlot): void {
    this.weekPlanService.setMeal(date, slot, { type: 'mock', title: SKIP_SENTINEL });
  }

  undoSkip(date: string, slot: MealSlot): void {
    this.weekPlanService.clearMeal(date, slot);
  }

  clearCustom(date: string, slot: MealSlot): void {
    this.weekPlanService.clearMeal(date, slot);
  }

  /** Cycles to the next mock suggestion and persists it so implicit acceptance uses the chosen one. */
  reSuggest(date: string, slot: MealSlot): void {
    const key = `${date}:${slot}`;
    const newOffset = ((this.suggestOffsets()[key] ?? 0) + 1) % MOCK_MEAL_SUGGESTIONS.length;
    this.suggestOffsets.update(o => ({ ...o, [key]: newOffset }));
    const baseIdx = MOCK_MEAL_SUGGESTIONS.indexOf(getMockSuggestion(date, slot));
    const title = MOCK_MEAL_SUGGESTIONS[(baseIdx + newOffset) % MOCK_MEAL_SUGGESTIONS.length];
    this.weekPlanService.setMeal(date, slot, { type: 'mock', title });
  }
}
