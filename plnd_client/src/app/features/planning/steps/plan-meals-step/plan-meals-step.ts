import { Component, DestroyRef, OnInit, computed, inject, input, signal, ViewChild, ElementRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { MealPlannerAgentService } from '../../../../core/services/meal-planner-agent.service';
import { formatDayName, formatDayDate, daysInRange } from '../../utils/date-format.utils';
import { MealPlanResponse, MealSlot, PlannedMeal, STANDARD_MEAL_SLOTS } from '../../../../core/models/week-plan';

const SLOT_LABELS: Partial<Record<MealSlot, string>> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
};

@Component({
  selector: 'app-plan-meals-step',
  standalone: true,
  imports: [],
  template: `
    <div class="plan-meals-wrapper">

      @if (firstRun()) {
        <div class="first-run-callout">
          <strong>Welcome!</strong> Let's plan your first week of meals. Approve, edit, or skip anything you like.
        </div>
      }

      <!-- Top toolbar: Refresh button + confirmation modal -->
      @if (!isGenerating() && unapprovedCount() > 0) {
        <div class="meals-toolbar">
          <button class="btn-refresh-all" type="button"
                  [disabled]="isGenerating()"
                  (click)="openRefreshModal()">
            🔀 Refresh meals <span class="badge">{{ unapprovedCount() }}</span>
          </button>
        </div>
      }

      @if (showRefreshModal()) {
        <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="refresh-modal-msg">
          <div class="modal-box">
            <p class="modal-msg" id="refresh-modal-msg">
              This will replace <strong>{{ unapprovedCount() }}</strong>
              {{ unapprovedCount() === 1 ? 'unapproved meal' : 'unapproved meals' }}.
              Approved and edited meals stay as they are. Continue?
            </p>
            <div class="modal-actions">
              <button class="btn-cancel" type="button" (click)="closeRefreshModal()">Cancel</button>
              <button class="btn-confirm" type="button" (click)="confirmRebalance()">Refresh</button>
            </div>
          </div>
        </div>
      }

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
                 [class.approved-g]="isApproved(day, slot)"
                 [class.skipped-g]="isSkipped(day, slot)"
                 [class.gc-editing]="isCellEditing(day, slot)"
                 [class.gc-loading]="isGenerating() && !getMeal(day, slot)">

              @if (isGenerating() && !getMeal(day, slot)) {
                <!-- Skeleton shimmer while auto-generating -->
                <div class="gc-skeleton"></div>

              } @else if (isSkipped(day, slot)) {
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

              } @else if (isApproved(day, slot)) {
                <button class="gc-x" type="button"
                        data-tip="Skip this meal"
                        (click)="skipMeal(day, slot)">×</button>
                <span class="gc-text approved-t">{{ getMeal(day, slot)?.title ?? '' }}</span>
                <div class="gc-actions">
                  <button class="gc-edit-custom" type="button"
                          (click)="startEdit(day, slot)">✏️ edit</button>
                </div>

              } @else {
                <!-- Proposed meal -->
                <button class="gc-x" type="button"
                        data-tip="Skip this meal"
                        (click)="skipMeal(day, slot)">×</button>
                <span class="gc-text">{{ getMeal(day, slot)?.title ?? '—' }}</span>
                <div class="gc-actions">
                  <button class="gc-approve" type="button"
                          data-tip="Approve this meal"
                          (click)="approveMeal(day, slot)">✓</button>
                  <button class="gc-pick" type="button"
                          data-tip="Edit this meal"
                          (click)="startEdit(day, slot)">✏️</button>
                  <button class="gc-suggest" type="button"
                          data-tip="Suggest a different meal"
                          (click)="refreshSlot(day, slot)">🔀</button>
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

    /* ── Toolbar ── */
    .meals-toolbar {
      display: flex; justify-content: flex-end; margin-bottom: 10px;
    }
    .btn-refresh-all {
      background: var(--color-surface-warm);
      border: 1px solid var(--color-border-row);
      border-radius: 7px; padding: 5px 12px;
      font-size: 12px; cursor: pointer; color: var(--color-text-body);
      display: flex; align-items: center; gap: 5px;
      transition: background 0.12s;
    }
    .btn-refresh-all:hover { background: var(--color-surface-base); }
    .btn-refresh-all:disabled { opacity: 0.4; cursor: default; }
    .badge {
      background: var(--color-accent-border); color: #fff;
      border-radius: 10px; padding: 1px 6px; font-size: 10px; font-weight: 700;
    }

    /* ── Modal ── */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.35);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal-box {
      background: var(--color-surface-white);
      border-radius: 12px; padding: 24px 28px; max-width: 380px; width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    }
    .modal-msg { font-size: 14px; color: var(--color-text-body); margin: 0 0 18px; line-height: 1.5; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
    .btn-cancel {
      background: transparent; border: 1px solid var(--color-border-row);
      border-radius: 7px; padding: 6px 14px; font-size: 13px; cursor: pointer;
      color: var(--color-text-muted);
    }
    .btn-confirm {
      background: var(--color-accent-border); border: none;
      border-radius: 7px; padding: 6px 14px; font-size: 13px; cursor: pointer;
      color: #fff; font-weight: 600;
    }

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
      background: var(--color-tooltip-bg); color: #fff; font-size: 10px; white-space: nowrap;
      padding: 3px 7px; border-radius: 4px; pointer-events: none; z-index: 10;
    }
    [data-tip]:hover::before {
      content: ''; position: absolute; bottom: calc(100% + 1px);
      left: 50%; transform: translateX(-50%);
      border: 4px solid transparent; border-top-color: var(--color-tooltip-bg);
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
    .gc.approved-g  { border-color: var(--color-accent-border); background: var(--color-accent-light); }
    .gc.skipped-g   { background: var(--color-surface-base); opacity: 0.45; }
    .gc.gc-editing  { border-color: var(--color-accent-border); box-shadow: 0 0 0 2px var(--color-accent-light); }
    .gc.gc-loading  { overflow: hidden; }

    /* ── Skeleton shimmer ── */
    .gc-skeleton {
      position: absolute; inset: 0; border-radius: 6px;
      background: linear-gradient(90deg,
        var(--color-surface-base) 25%,
        var(--color-surface-warm) 50%,
        var(--color-surface-base) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s ease-in-out infinite;
    }
    @keyframes shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
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

    /* Meal text */
    .gc-text {
      font-size: 11px; color: var(--color-text-body); font-style: italic; opacity: 0.75;
      line-height: 1.3; flex: 1; padding-right: 14px; margin-bottom: 5px;
      pointer-events: none;
    }
    .gc-text.approved-t {
      color: var(--color-accent-dark); font-weight: 600; font-style: normal; opacity: 1;
    }
    .gc-text.skip-t {
      color: var(--color-text-muted); font-size: 10px; font-style: italic;
    }

    /* Ghost action buttons row */
    .gc-actions { display: flex; gap: 4px; }
    .gc-approve,
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
    .gc-approve:hover {
      background: #dcfce7;
      border-color: #86efac;
      color: #166534;
    }
    .gc-pick:hover {
      background: var(--color-accent-light);
      border-color: var(--color-accent-border);
    }
    .gc-suggest:hover {
      background: var(--color-surface-base);
      border-color: var(--color-border-row);
    }

    /* Approved meal edit button */
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
export class PlanMealsStepComponent implements OnInit {
  private readonly weekPlanService         = inject(WeekPlanService);
  private readonly mealPlannerAgentService = inject(MealPlannerAgentService);
  private readonly destroyRef              = inject(DestroyRef);

  @ViewChild('mealInput') private mealInput?: ElementRef<HTMLInputElement>;

  // Onboarding-flow overrides — defaults leave weekly wizard behaviour unchanged
  readonly firstRun  = input(false);
  readonly planStart = input<string | undefined>(undefined);
  readonly planEnd   = input<string | undefined>(undefined);

  readonly slots = STANDARD_MEAL_SLOTS;

  readonly horizonDays = computed(() => {
    const start = this.planStart();
    const end   = this.planEnd();
    return (start && end)
      ? daysInRange(start, end)
      : this.weekPlanService.horizonDays();
  });

  readonly gridColumns  = computed(() => `68px repeat(${this.horizonDays().length}, 1fr)`);
  readonly isGenerating = computed(() => this.weekPlanService.isGenerating());

  readonly editingCell     = signal<{ date: string; slot: MealSlot } | null>(null);
  readonly editingValue    = signal('');
  private confirmingEdit   = false;
  readonly showRefreshModal = signal(false);

  readonly unapprovedCount = computed(() => {
    const meals = this.weekPlanService.scheduledMeals();
    return this.horizonDays().reduce((n, date) =>
      n + STANDARD_MEAL_SLOTS.filter(
        slot => (meals[date]?.[slot]?.approvalState ?? 'proposed') === 'proposed'
      ).length,
    0);
  });

  ngOnInit(): void {
    const meals  = this.weekPlanService.scheduledMeals();
    const hasAny = this.horizonDays().some(d => Object.keys(meals[d] ?? {}).length > 0);
    if (!hasAny) {
      const start = this.planStart();
      const end   = this.planEnd();
      this.runAgentPlan(
        this.mealPlannerAgentService.generateWeek(
          (start && end) ? start : this.weekPlanService.planStart(),
          this.weekPlanService.currentState(),
        ),
      );
    }
  }

  private runAgentPlan(obs$: Observable<MealPlanResponse>): void {
    this.weekPlanService.setGenerating(true);
    obs$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next:  resp => this.weekPlanService.applyAgentMeals(resp.meals),
      error: ()   => this.weekPlanService.setGenerating(false),
    });
  }

  // ── Formatters ────────────────────────────────────────────

  readonly formatDayName = formatDayName;
  readonly formatDayDate = formatDayDate;

  slotLabel(slot: MealSlot): string {
    return SLOT_LABELS[slot] ?? slot;
  }

  // ── Cell state queries ─────────────────────────────────────

  getMeal(date: string, slot: MealSlot): PlannedMeal | undefined {
    return this.weekPlanService.scheduledMeals()[date]?.[slot];
  }

  isSkipped(date: string, slot: MealSlot): boolean {
    return this.getMeal(date, slot)?.approvalState === 'skipped';
  }

  isApproved(date: string, slot: MealSlot): boolean {
    return this.getMeal(date, slot)?.approvalState === 'approved';
  }

  isCellEditing(date: string, slot: MealSlot): boolean {
    const e = this.editingCell();
    return e?.date === date && e?.slot === slot;
  }

  // ── Actions ───────────────────────────────────────────────

  approveMeal(date: string, slot: MealSlot): void {
    this.weekPlanService.approveMeal(date, slot);
  }

  skipMeal(date: string, slot: MealSlot): void {
    this.weekPlanService.skipMeal(date, slot);
  }

  undoSkip(date: string, slot: MealSlot): void {
    this.weekPlanService.undoSkip(date, slot);
  }

  startEdit(date: string, slot: MealSlot): void {
    const existing = this.getMeal(date, slot);
    this.editingValue.set(existing?.title ?? '');
    this.editingCell.set({ date, slot });
    setTimeout(() => this.mealInput?.nativeElement.focus());
  }

  confirmEdit(date: string, slot: MealSlot, value: string): void {
    const trimmed = value.trim();
    this.confirmingEdit = true;
    this.editingCell.set(null);
    this.editingValue.set('');
    if (!trimmed) { this.confirmingEdit = false; return; }
    // Resolve via agent; auto-approves the cell with the matched meal ref
    this.mealPlannerAgentService
      .resolveText(trimmed, slot, date)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: resp =>
          this.weekPlanService.setMealRef(date, slot, resp.meal_ref, trimmed, resp.estimated_nutrition),
        error: () =>
          this.weekPlanService.setMealRef(date, slot, null, trimmed),
      });
    this.confirmingEdit = false;
  }

  cancelEdit(): void {
    if (this.confirmingEdit) return;
    this.editingCell.set(null);
    this.editingValue.set('');
  }

  /** Per-cell agent refresh — suggests a replacement and auto-approves it.
   *  Passes the current mealRef as avoid so the agent doesn't return the same meal. */
  refreshSlot(date: string, slot: MealSlot): void {
    const existing = this.getMeal(date, slot);
    const avoid    = existing?.mealRef ? [existing.mealRef] : [];
    this.mealPlannerAgentService
      .suggestSlot(date, slot, avoid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next:  entry => this.weekPlanService.setMealRef(date, slot, entry.meal_ref, entry.title, entry.estimated_nutrition, entry.estimated),
        error: ()    => { /* leave cell unchanged; no user-visible feedback for now */ },
      });
  }

  // ── Top-level Refresh modal ────────────────────────────────

  openRefreshModal(): void {
    this.showRefreshModal.set(true);
  }

  closeRefreshModal(): void {
    this.showRefreshModal.set(false);
  }

  confirmRebalance(): void {
    this.showRefreshModal.set(false);
    const start = this.planStart();
    const end   = this.planEnd();
    this.runAgentPlan(
      this.mealPlannerAgentService.rebalance(
        (start && end) ? start : this.weekPlanService.planStart(),
        this.weekPlanService.currentState(),
      ),
    );
  }
}
