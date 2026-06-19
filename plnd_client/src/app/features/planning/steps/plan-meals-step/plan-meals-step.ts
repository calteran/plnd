import { Component, DestroyRef, OnInit, computed, inject, input, signal, ViewChild, ElementRef, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription } from 'rxjs';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { MealPlannerAgentService } from '../../../../core/services/meal-planner-agent.service';
import { DayTypesMealsService } from '../../../../core/services/day-types-meals.service';
import { UserMealsService } from '../../../../core/services/user-meals.service';
import { UserDishesService } from '../../../../core/services/user-dishes.service';
import { MealPlanLoadingComponent } from '../../../onboarding/shared/meal-plan-loading/meal-plan-loading';
import { formatDayName, formatDayDate, daysInRange } from '../../utils/date-format.utils';
import { FailedSlot, MealPlanResponse, MealSlot, PlannedMeal, UnplannableReason } from '../../../../core/models/week-plan';
import { MealPatternEntry } from '../../../../core/models/meal-pattern';

@Component({
  selector: 'app-plan-meals-step',
  standalone: true,
  imports: [MealPlanLoadingComponent],
  template: `
    <div class="plan-meals-wrapper">

      @if (isGenerating()) {
        <app-meal-plan-loading
          [slotsByDay]="loaderSlotsByDay()"
          [blockedNames]="blockedNames()"
          (cancelClick)="cancelGeneration()" />
      } @else if (cancelled()) {
        <div class="cancel-card" role="alert">
          <p class="cancel-msg">Generation cancelled.</p>
          <div class="cancel-actions">
            <button type="button" class="btn-cancel-secondary" (click)="dismissCancellation()">Skip — I'll plan manually</button>
            <button type="button" class="btn-cancel-primary" (click)="retryGeneration()">Try again</button>
          </div>
        </div>
      } @else {

      @if (firstRun()) {
        <div class="first-run-callout">
          <strong>Welcome!</strong> Let's plan your first week of meals. Approve, edit, or skip anything you like.
        </div>
      }

      @if (errorMessage()) {
        <div class="gen-error" role="alert">{{ errorMessage() }}</div>
      }

      @if (unplannableReason() === 'no_anchor_template') {
        <div class="no-template-banner" role="status">
          We couldn't plan any meals because you haven't set up your day types yet.
          Add a day type with its meal times, then come back to plan your week.
        </div>
      }

      @if (partialBannerMsg()) {
        <div class="partial-banner" role="alert">{{ partialBannerMsg() }}</div>
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
        @for (entry of allSlots(); track entry.id) {
          <div class="cell-slot-label">
            <span class="slot-lbl">{{ entry.name }}</span>
          </div>
          @for (day of horizonDays(); track day) {
            @if (hasSlotForDate(day, entry.name)) {
            <div class="gc"
                 [class.approved-g]="isApproved(day, entry.name)"
                 [class.skipped-g]="isSkipped(day, entry.name)"
                 [class.gc-editing]="isCellEditing(day, entry.name)"
                 [class.gc-swapping]="isSwapping(day, entry.name)"
                 [class.gc-failed]="isFailedSlot(day, entry.name)">

              @if (isSwapping(day, entry.name)) {
                <span class="gc-swap-pending" role="status">
                  <span class="gc-spinner" aria-hidden="true"></span>
                  Finding a new meal…
                </span>

              } @else if (isSkipped(day, entry.name)) {
                <span class="gc-text skip-t">— skipped</span>
                <div class="gc-actions">
                  <button class="gc-undo" type="button"
                          (click)="undoSkip(day, entry.name)">undo</button>
                </div>

              } @else if (isCellEditing(day, entry.name)) {
                <input #mealInput
                       class="mock-input"
                       type="text"
                       [value]="editingValue()"
                       (keydown.enter)="confirmEdit(day, entry.name, mealInput.value)"
                       (keydown.escape)="cancelEdit()"
                       (blur)="cancelEdit()">
                <span class="input-hint">Enter · Esc to cancel</span>

              } @else if (isApproved(day, entry.name)) {
                <button class="gc-x" type="button"
                        data-tip="Skip this meal"
                        (click)="skipMeal(day, entry.name)">×</button>
                <span class="gc-text approved-t">{{ getMeal(day, entry.name)?.title ?? '' }}</span>
                <div class="gc-actions">
                  <button class="gc-edit-custom" type="button"
                          (click)="startEdit(day, entry.name)">✏️ edit</button>
                </div>

              } @else {
                <!-- Proposed meal -->
                <button class="gc-x" type="button"
                        data-tip="Skip this meal"
                        (click)="skipMeal(day, entry.name)">×</button>
                <span class="gc-text">{{ getMeal(day, entry.name)?.title ?? '—' }}</span>
                <div class="gc-actions">
                  <button class="gc-approve" type="button"
                          data-tip="Approve this meal"
                          (click)="approveMeal(day, entry.name)">✓</button>
                  <button class="gc-pick" type="button"
                          data-tip="Edit this meal"
                          (click)="startEdit(day, entry.name)">✏️</button>
                  <button class="gc-suggest" type="button"
                          data-tip="Suggest a different meal"
                          (click)="refreshSlot(day, entry.name)">🔀</button>
                </div>
              } <!-- end @else proposed -->

            </div> <!-- end .gc -->
            } @else {
              <div class="gc gc-na" aria-hidden="true"></div>
            }
          } <!-- end @for day -->
        }

      </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: block; }

    .plan-meals-wrapper { overflow-x: auto; padding-bottom: 8px; }

    /* ── Generation error banner ── */
    .gen-error {
      background: var(--color-destructive-light);
      border: 1px solid var(--color-destructive-border);
      border-radius: 8px;
      color: var(--color-destructive);
      font-size: 13px;
      padding: 10px 14px;
      margin-bottom: 10px;
    }

    /* ── Partial-success banner ── */
    .partial-banner {
      background: var(--color-warning-light);
      border: 1px solid var(--color-warning-border);
      border-radius: 8px;
      color: var(--color-warning);
      font-size: 13px;
      padding: 10px 14px;
      margin-bottom: 10px;
    }

    /* ── No-template guidance banner ── */
    .no-template-banner {
      background: var(--color-accent-light);
      border: 1px solid var(--color-accent-border);
      border-radius: 8px;
      color: var(--color-accent-dark);
      font-size: 13px;
      padding: 10px 14px;
      margin-bottom: 10px;
    }

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
      background: var(--color-accent-border); color: var(--color-btn-accent-text);
      border-radius: 10px; padding: 1px 6px; font-size: 10px; font-weight: 700;
    }

    /* ── Modal ── */
    .modal-overlay {
      position: fixed; inset: 0; background: var(--color-overlay-scrim);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal-box {
      background: var(--color-surface-white);
      border-radius: 12px; padding: 24px 28px; max-width: 380px; width: 90%;
      box-shadow: var(--shadow-modal);
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
      color: var(--color-btn-accent-text); font-weight: 600;
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
      background: var(--color-tooltip-bg); color: var(--color-tooltip-text); font-size: 10px; white-space: nowrap;
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
    .gc.gc-na { background: var(--color-surface-base); opacity: 0.2; border-style: dashed; }
    .gc.gc-failed { border-color: var(--color-warning-border); background: var(--color-warning-light); }
    .gc.gc-swapping { border-color: var(--color-accent-border); }

    /* In-flight swap feedback */
    .gc-swap-pending {
      display: flex; align-items: center; gap: 6px;
      font-size: 11px; font-style: italic; color: var(--color-text-muted);
      flex: 1;
    }
    .gc-spinner {
      width: 11px; height: 11px; flex: none;
      border: 2px solid var(--color-accent-light);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: gc-spin 0.6s linear infinite;
    }
    @keyframes gc-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .gc-spinner { animation: none; }
    }

    /* ── Cancellation card (shown when user cancels in-flight generation) ── */
    .cancel-card {
      background: var(--color-surface-warm);
      border: 1px solid var(--color-accent-border);
      border-radius: 12px;
      padding: 24px 24px 18px;
      max-width: 480px;
      margin: 0 auto;
      text-align: center;
    }
    .cancel-msg {
      font-size: 14px; color: var(--color-text-primary);
      margin: 0 0 14px; line-height: 1.5;
    }
    .cancel-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .btn-cancel-secondary,
    .btn-cancel-primary {
      border-radius: 7px; padding: 7px 14px;
      font-size: 13px; cursor: pointer;
    }
    .btn-cancel-secondary {
      background: transparent;
      border: 1px solid var(--color-border-row);
      color: var(--color-text-muted);
    }
    .btn-cancel-primary {
      background: var(--color-accent-border); border: none;
      color: var(--color-btn-accent-text); font-weight: 600;
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
      border: 1px solid var(--color-border-row);
      border-radius: 5px; padding: 3px 0;
      font-size: 12px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--color-text-muted);
      transition: background 0.12s, border-color 0.12s;
    }
    .gc-approve:hover {
      background: var(--color-success-light);
      border-color: var(--color-success-border);
      color: var(--color-success);
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
      background: transparent; border: 1px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
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
  private readonly dayTypesMealsService    = inject(DayTypesMealsService);
  private readonly userMealsService        = inject(UserMealsService);
  private readonly userDishesService       = inject(UserDishesService);
  private readonly destroyRef              = inject(DestroyRef);

  @ViewChild('mealInput') private mealInput?: ElementRef<HTMLInputElement>;

  // Onboarding-flow overrides — defaults leave weekly wizard behaviour unchanged
  readonly firstRun        = input(false);
  readonly planStart       = input<string | undefined>(undefined);
  readonly planEnd         = input<string | undefined>(undefined);
  // When provided, overrides DayTypesMealsService for slot resolution.
  // Pass (date: string) => MealPatternEntry[] from the caller's context (e.g., onboarding state).
  readonly getMealsForDate = input<((date: string) => MealPatternEntry[]) | undefined>(undefined);

  readonly allSlots = computed(() => {
    const fn = this.getMealsForDate();
    const seen = new Set<string>();
    return this.horizonDays()
      .flatMap(d => (fn ? fn(d) : this.dayTypesMealsService.mealsForDate(d)))
      .filter(e => seen.has(e.name) ? false : seen.add(e.name))
      .sort((a, b) => a.sort_order - b.sort_order);
  });

  slotsForDate(date: string): MealPatternEntry[] {
    const fn = this.getMealsForDate();
    return fn ? fn(date) : this.dayTypesMealsService.mealsForDate(date);
  }

  hasSlotForDate(date: string, slotName: string): boolean {
    return this.slotsForDate(date).some(e => e.name === slotName);
  }

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
  readonly errorMessage     = signal<string | null>(null);
  readonly failedSlots      = signal<FailedSlot[]>([]);
  // Set when generation returns no meals for an actionable reason (e.g. the user
  // has no day-type template); distinct from an error or a partial fill.
  readonly unplannableReason = signal<UnplannableReason | null>(null);
  readonly cancelled        = signal(false);
  private  totalPlannedCount = signal(0);
  private  generationSub: Subscription | null = null;
  // Cells with an in-flight agent swap (refreshSlot). Keyed by `${date}|${slot}` so the
  // cell can show immediate "finding…" feedback instead of sitting unchanged until the
  // round-trip lands.
  readonly swappingSlots    = signal<ReadonlySet<string>>(new Set());

  readonly blockedNames = computed(() => [
    ...this.userMealsService.meals().filter(m => m.is_blocked).map(m => m.name),
    ...this.userDishesService.dishes().filter(d => d.is_blocked).map(d => d.name),
  ]);

  readonly loaderSlotsByDay = computed(() =>
    this.horizonDays().map(day => ({
      day,
      slots: this.slotsForDate(day).map(s => s.name),
    })),
  );
  readonly partialBannerMsg  = computed(() => {
    const failed = this.failedSlots();
    if (failed.length === 0) return null;
    const total  = this.totalPlannedCount();
    const filled = total - failed.length;
    return `Filled ${filled} of ${total} slots. Tap a missing meal to retry.`;
  });

  readonly unapprovedCount = computed(() => {
    const meals = this.weekPlanService.scheduledMeals();
    return this.horizonDays().reduce((n, date) =>
      n + this.slotsForDate(date).filter(
        s => (meals[date]?.[s.name]?.approvalState ?? 'proposed') === 'proposed'
      ).length,
    0);
  });

  ngOnInit(): void {
    if (!this.getMealsForDate()) {
      this.dayTypesMealsService.load();
    }
    this.userMealsService.load();
    this.userDishesService.load();
    const meals  = this.weekPlanService.scheduledMeals();
    const hasAny = this.horizonDays().some(d => Object.keys(meals[d] ?? {}).length > 0);
    if (!hasAny) {
      this.startGeneration();
    }
  }

  private startGeneration(): void {
    const start = this.planStart();
    const end   = this.planEnd();
    this.runAgentPlan(
      this.mealPlannerAgentService.generateWeek(
        (start && end) ? start : this.weekPlanService.planStart(),
        this.weekPlanService.currentState(),
      ),
    );
  }

  private runAgentPlan(obs$: Observable<MealPlanResponse>): void {
    this.errorMessage.set(null);
    this.failedSlots.set([]);
    this.unplannableReason.set(null);
    this.totalPlannedCount.set(0);
    this.cancelled.set(false);
    this.weekPlanService.setGenerating(true);
    this.generationSub?.unsubscribe();
    this.generationSub = obs$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: resp => {
        this.weekPlanService.applyAgentMeals(resp.meals);
        this.totalPlannedCount.set(resp.meals.length + (resp.failed_slots?.length ?? 0));
        this.failedSlots.set(resp.failed_slots ?? []);
        this.unplannableReason.set(resp.unplannable_reason ?? null);
        this.generationSub = null;
      },
      error: () => {
        this.weekPlanService.setGenerating(false);
        this.errorMessage.set("Couldn't generate meal plan — please try again.");
        this.generationSub = null;
      },
    });
  }

  cancelGeneration(): void {
    this.generationSub?.unsubscribe();
    this.generationSub = null;
    this.weekPlanService.setGenerating(false);
    this.cancelled.set(true);
  }

  dismissCancellation(): void {
    this.cancelled.set(false);
  }

  retryGeneration(): void {
    this.startGeneration();
  }

  // ── Formatters ────────────────────────────────────────────

  readonly formatDayName = formatDayName;
  readonly formatDayDate = formatDayDate;

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

  isFailedSlot(date: string, slot: MealSlot): boolean {
    return this.failedSlots().some(f => f.date === date && f.meal_name === slot);
  }

  private swapKey(date: string, slot: MealSlot): string {
    return `${date}|${slot}`;
  }

  isSwapping(date: string, slot: MealSlot): boolean {
    return this.swappingSlots().has(this.swapKey(date, slot));
  }

  private setSwapping(date: string, slot: MealSlot, on: boolean): void {
    this.swappingSlots.update(set => {
      const next = new Set(set);
      if (on) next.add(this.swapKey(date, slot));
      else next.delete(this.swapKey(date, slot));
      return next;
    });
  }

  private clearFailedSlot(date: string, slot: MealSlot): void {
    this.failedSlots.update(slots => slots.filter(f => !(f.date === date && f.meal_name === slot)));
  }

  // ── Actions ───────────────────────────────────────────────

  approveMeal(date: string, slot: MealSlot): void {
    this.weekPlanService.approveMeal(date, slot);
  }

  skipMeal(date: string, slot: MealSlot): void {
    this.weekPlanService.skipMeal(date, slot);
    this.clearFailedSlot(date, slot);
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
    // Optimistically show the user's text immediately so the cell never reverts to the
    // pre-edit meal while the agent round-trips (#962). The agent response then enriches
    // this entry with the matched meal ref + nutrition.
    this.weekPlanService.setMealRef(date, slot, null, trimmed);
    this.clearFailedSlot(date, slot);
    // Resolve via agent; auto-approves the cell with the matched meal ref
    this.mealPlannerAgentService
      .resolveText(trimmed, slot, date)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: resp => {
          this.weekPlanService.setMealRef(date, slot, resp.meal_ref, trimmed, resp.estimated_nutrition);
        },
        error: () => {
          // Optimistic entry already reflects the user's text; nothing more to do.
        },
      });
    this.confirmingEdit = false;
  }

  cancelEdit(): void {
    if (this.confirmingEdit) return;
    this.editingCell.set(null);
    this.editingValue.set('');
  }

  /** Per-cell agent refresh — suggests a replacement the user can review.
   *  The new meal stays *proposed* (not auto-approved) so the approve/suggest actions
   *  remain available for re-rolling or accepting it.
   *  Passes the current mealRef as avoid so the agent doesn't return the same meal. */
  refreshSlot(date: string, slot: MealSlot): void {
    if (this.isSwapping(date, slot)) return;
    const existing = this.getMeal(date, slot);
    const avoid    = existing?.mealRef ? [existing.mealRef] : [];
    // Show immediate in-flight feedback so the click registers before the agent responds.
    this.setSwapping(date, slot, true);
    this.mealPlannerAgentService
      .suggestSlot(date, slot, avoid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: entry => {
          this.weekPlanService.proposeMealRef(date, slot, entry.meal_ref, entry.title ?? '', entry.estimated_nutrition, entry.estimated);
          this.clearFailedSlot(date, slot);
          this.setSwapping(date, slot, false);
        },
        error: () => { this.setSwapping(date, slot, false); /* leave cell unchanged */ },
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
