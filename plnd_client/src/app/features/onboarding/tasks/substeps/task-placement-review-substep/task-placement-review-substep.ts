import {
  Component,
  DestroyRef,
  EventEmitter,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AgentService } from '../../../../../core/services/agent.service';
import { OnboardingStateService } from '../../../onboarding-state.service';
import {
  PlaceTasksRequest,
  PlaceTasksEntry,
  PlanEntryRequest,
  EnergyLevel,
} from '../../../../../core/models/week-plan';
import { ScheduleTemplate } from '../../../../../core/models/schedule-template';
import { OnboardingLoadingScreenComponent } from '../../../shared/onboarding-loading-screen/onboarding-loading-screen';

// ── Meal slot divider definitions ────────────────────────────────────────────

type MealSlotLabel = 'BREAKFAST' | 'LUNCH' | 'DINNER';

interface MealSlotDivider {
  kind: 'meal';
  label: MealSlotLabel;
}

interface TaskRow {
  kind: 'task';
  entry: PlaceTasksEntry;
  // index into the task entries array; -1 for display-only routine rows
  entryIndex: number;
  // routine rows are display-only — the backend expands templates via schedule_template_ids
  isRoutine: boolean;
}

type DayRow = MealSlotDivider | TaskRow;

interface DayCard {
  date: string;        // ISO date
  displayDate: string; // e.g. "Apr 28"
  dayName: string;     // e.g. "MONDAY"
  rows: DayRow[];
}

// ── Edit state ───────────────────────────────────────────────────────────────

interface EditState {
  entryIndex: number;
  scheduledDate: string;
  timeWindowStart: string | undefined;
  durationMinutes: number;
  energyRequired: EnergyLevel;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

function formatDisplayDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  return `${MONTH_ABBREVS[d.getMonth()]} ${d.getDate()}`;
}

function getDayName(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  return DAY_NAMES[d.getDay()];
}

function slotOf(entry: PlaceTasksEntry): 'morning' | 'afternoon' | 'evening' {
  if (entry.after_milepost === 'breakfast') return 'morning';
  if (entry.after_milepost === 'dinner') return 'evening';
  if (entry.after_milepost === 'lunch') return 'afternoon';
  // Fixed tasks: bucket by wall-clock time
  const t = entry.time_window_start ?? '12:00';
  if (t < '12:00') return 'morning';
  if (t < '17:00') return 'afternoon';
  return 'evening';
}

function buildDayCards(
  taskEntries: PlaceTasksEntry[],
  routineEntries: PlaceTasksEntry[],
  start: string,
  end: string,
): DayCard[] {
  const allDates = datesBetween(start, end);
  return allDates.map(date => {
    const dayTasks = taskEntries
      .map((entry, idx) => ({ entry, idx, isRoutine: false }))
      .filter(({ entry }) => entry.scheduled_date === date);

    const dayRoutines = routineEntries
      .map((entry, idx) => ({ entry, idx, isRoutine: true }))
      .filter(({ entry }) => entry.scheduled_date === date);

    const bySlot = (slot: 'morning' | 'afternoon' | 'evening'): TaskRow[] =>
      [...dayTasks, ...dayRoutines]
        .filter(({ entry }) => slotOf(entry) === slot)
        .sort((a, b) => (a.entry.time_window_start ?? '').localeCompare(b.entry.time_window_start ?? ''))
        .map(({ entry, idx, isRoutine }) => ({
          kind: 'task' as const,
          entry,
          entryIndex: isRoutine ? -1 : idx,
          isRoutine,
        }));

    const rows: DayRow[] = [
      { kind: 'meal', label: 'BREAKFAST' },
      ...bySlot('morning'),
      { kind: 'meal', label: 'LUNCH' },
      ...bySlot('afternoon'),
      { kind: 'meal', label: 'DINNER' },
      ...bySlot('evening'),
    ];

    return {
      date,
      displayDate: formatDisplayDate(date),
      dayName: getDayName(date),
      rows,
    };
  });
}

// ── Routine expansion ─────────────────────────────────────────────────────────

const RRULE_DAY_MAP: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

export function expandTemplatesToEntries(
  templates: ScheduleTemplate[],
  planStart: string,
  planEnd: string,
): PlaceTasksEntry[] {
  const dates = datesBetween(planStart, planEnd);
  const entries: PlaceTasksEntry[] = [];

  for (const t of templates) {
    const rule = t.recurrence_rule ?? '';
    let matchingDates: string[];

    if (rule === 'FREQ=DAILY') {
      matchingDates = dates;
    } else if (rule.startsWith('FREQ=WEEKLY')) {
      // Parse BYDAY by splitting on ';' so extra params (e.g. INTERVAL=2) don't break matching.
      const parts = rule.split(';');
      const bydayPart = parts.find(p => p.startsWith('BYDAY='));
      if (!bydayPart) continue; // bare FREQ=WEEKLY with no days — skip
      const byday = bydayPart.slice('BYDAY='.length);
      const targetDays = new Set(
        byday.split(',')
          .map(d => RRULE_DAY_MAP[d])
          .filter((n): n is number => n !== undefined),
      );
      matchingDates = dates.filter(d => targetDays.has(new Date(`${d}T12:00:00`).getDay()));
    } else {
      // FREQ=MONTHLY, FREQ=YEARLY, unknown — skip client expansion.
      // Backend handles these via schedule_template_ids.
      continue;
    }

    for (const date of matchingDates) {
      entries.push({
        title: t.title,
        scheduled_date: date,
        task_type: t.task_type,
        duration_minutes: t.duration_minutes ?? 30,
        energy_required: t.energy_required,
        // Preserve null as undefined; slotOf() defaults undefined to '12:00' (afternoon slot)
        time_window_start: t.time_window_start ?? undefined,
      });
    }
  }

  return entries;
}

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-task-placement-review-substep',
  standalone: true,
  imports: [OnboardingLoadingScreenComponent],
  template: `
    <div class="placement-review">

      @if (isEmpty()) {
        <!-- Empty state -->
        <div class="empty-state">
          <p class="empty-msg">No tasks or routines to place. Add items in the previous step to see them here.</p>
          <button
            type="button"
            class="save-btn"
            (click)="onSaveAndReturn()"
          >Save &amp; Return to Hub &rarr;</button>
        </div>

      } @else if (isLoading()) {
        <!-- Loading state -->
        <app-onboarding-loading-screen
          [taskCount]="loadingTaskNames().length"
          [routineCount]="loadingRoutineCount()"
          [taskNames]="loadingTaskNames()"
        />

      } @else if (hasError()) {
        <!-- Error state -->
        <div class="error-state">
          <p class="error-msg">Failed to place tasks. Please try again.</p>
          <button
            type="button"
            class="retry-btn"
            (click)="loadPlacement()"
          >Retry</button>
        </div>

      } @else {
        <!-- Day-card grid -->
        <div class="day-grid">
          @for (card of dayCards(); track card.date) {
            <div class="day-card">
              <!-- Card header -->
              <div class="day-header">
                <span class="day-name">{{ card.dayName }}</span>
                <span class="day-date">{{ card.displayDate }}</span>
              </div>

              <!-- Interleaved timeline rows -->
              @for (row of card.rows; track rowTrack(row)) {
                @if (row.kind === 'meal') {
                  <div class="meal-divider">
                    <span class="meal-label">{{ row.label }}</span>
                    <em class="meal-placeholder">&mdash;</em>
                  </div>
                } @else {
                  @if (editState() && editState()!.entryIndex === row.entryIndex) {
                    <!-- Edit form -->
                    <div class="task-row task-row--editing">
                      <div class="edit-form">
                        <label class="edit-field">
                          <span class="edit-label">Date</span>
                          <select
                            class="edit-input"
                            [value]="editState()!.scheduledDate"
                            (change)="onEditDate($any($event.target).value)"
                            aria-label="Task date"
                          >
                            @for (d of planDates(); track d.value) {
                              <option [value]="d.value">{{ d.label }}</option>
                            }
                          </select>
                        </label>
                        <label class="edit-field">
                          <span class="edit-label">Time</span>
                          <input
                            type="time"
                            class="edit-input"
                            [value]="editState()!.timeWindowStart"
                            (change)="onEditTime($any($event.target).value)"
                            aria-label="Task time"
                          />
                        </label>
                        <label class="edit-field">
                          <span class="edit-label">Duration (min)</span>
                          <input
                            type="number"
                            class="edit-input edit-input--short"
                            min="1"
                            [value]="editState()!.durationMinutes"
                            (change)="onEditDuration(+$any($event.target).value)"
                            aria-label="Duration in minutes"
                          />
                        </label>
                        <label class="edit-field">
                          <span class="edit-label">Energy</span>
                          <select
                            class="edit-input"
                            [value]="editState()!.energyRequired"
                            (change)="onEditEnergy($any($event.target).value)"
                            aria-label="Energy level"
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </label>
                        <div class="edit-actions">
                          <button
                            type="button"
                            class="save-edit-btn"
                            (click)="saveEdit()"
                          >Save</button>
                          <button
                            type="button"
                            class="remove-edit-btn"
                            (click)="removeEntry(row.entryIndex)"
                          >Remove</button>
                        </div>
                      </div>
                    </div>
                  } @else {
                    <!-- Default task row -->
                    <div class="task-row" [class.task-row--routine]="row.isRoutine">
                      @if (row.entry.time_window_start) {
                        <span class="task-time">{{ row.entry.time_window_start }}</span>
                      }
                      <span class="task-title">{{ row.entry.title }}</span>
                      <div class="task-meta">
                        <span class="energy-badge energy-badge--{{ row.entry.energy_required }}">
                          {{ row.entry.energy_required }}
                        </span>
                        @if (!row.isRoutine) {
                          <button
                            type="button"
                            class="edit-btn"
                            (click)="openEdit(row.entryIndex)"
                            [attr.aria-label]="'Edit ' + row.entry.title"
                          >Edit</button>
                        }
                      </div>
                    </div>
                  }
                }
              }
            </div>
          }
        </div>

        <!-- Meal slot note -->
        <p class="meal-slot-note">Meal slots will fill in once you complete the Food &amp; Meals section.</p>

        <!-- Save & Return -->
        <button
          type="button"
          class="save-btn"
          (click)="onSaveAndReturn()"
        >Save &amp; Return to Hub &rarr;</button>
      }

    </div>
  `,
  styles: [`
    .placement-review {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* ── Empty / Error ── */

    .empty-state,
    .error-state {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
    }

    .empty-msg,
    .error-msg {
      margin: 0;
      font-size: 14px;
      color: #6b7280;
    }

    .error-msg {
      color: #dc2626;
    }

    .retry-btn {
      background: none;
      border: 1.5px solid #d1d5db;
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 13px;
      cursor: pointer;
      color: #374151;
    }

    .retry-btn:hover {
      border-color: #d97706;
      color: #d97706;
    }

    /* ── Day grid ── */

    .day-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .day-card {
      border: 1.5px solid #fde68a;
      border-radius: 10px;
      overflow: hidden;
      background: #ffffff;
    }

    .day-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 10px 14px;
      background: #fef3c7;
    }

    .day-name {
      font-size: 13px;
      font-weight: 800;
      color: #78350f;
      letter-spacing: 0.04em;
    }

    .day-date {
      font-size: 12px;
      color: #92400e;
    }

    /* ── Meal dividers ── */

    .meal-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 14px;
      background: #fef3c7;
      border-top: 1px solid #fde68a;
    }

    .meal-label {
      font-size: 11px;
      font-weight: 700;
      color: #78350f;
      letter-spacing: 0.06em;
      min-width: 72px;
    }

    .meal-placeholder {
      font-size: 12px;
      color: #9ca3af;
    }

    /* ── Task rows ── */

    .task-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      border-top: 1px solid #f3f4f6;
      gap: 8px;
    }

    .task-row--editing {
      background: #ffffff;
      border-left: 3px solid #d97706;
      padding-left: 11px;
    }

    .task-time {
      color: #d97706;
      font-weight: 700;
      font-size: 11px;
      margin-right: 6px;
    }

    .task-title {
      font-size: 13px;
      color: #1f2937;
      flex: 1;
    }

    .task-meta {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .energy-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 20px;
      text-transform: lowercase;
    }

    .energy-badge--low {
      background: #fef9c3;
      color: #854d0e;
    }

    .energy-badge--medium {
      background: #fde68a;
      color: #78350f;
    }

    .energy-badge--high {
      background: #fca5a5;
      color: #7f1d1d;
    }

    .edit-btn {
      background: none;
      border: 1.5px solid #d1d5db;
      border-radius: 5px;
      padding: 3px 9px;
      font-size: 12px;
      cursor: pointer;
      color: #6b7280;
    }

    .edit-btn:hover {
      border-color: #d97706;
      color: #d97706;
    }

    /* ── Edit form ── */

    .edit-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      padding: 4px 0;
    }

    .edit-field {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 11px;
      font-weight: 700;
      color: #78350f;
    }

    .edit-label {
      font-size: 11px;
      font-weight: 700;
      color: #78350f;
    }

    .edit-input {
      border: 1.5px solid #fde68a;
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 13px;
      outline: none;
      max-width: 200px;
    }

    .edit-input--short {
      max-width: 80px;
    }

    .edit-input:focus {
      border-color: #d97706;
    }

    .edit-actions {
      display: flex;
      gap: 8px;
      padding-top: 4px;
    }

    .save-edit-btn {
      background: #d97706;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 6px 16px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .save-edit-btn:hover {
      background: #b45309;
    }

    .remove-edit-btn {
      background: none;
      border: 1.5px solid #d1d5db;
      border-radius: 6px;
      padding: 6px 16px;
      font-size: 13px;
      cursor: pointer;
      color: #6b7280;
    }

    .remove-edit-btn:hover {
      border-color: #dc2626;
      color: #dc2626;
    }

    /* ── Routine rows ── */

    .task-row--routine {
      opacity: 0.85;
    }

    .routine-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 7px;
      border-radius: 4px;
      background: #e0e7ff;
      color: #4338ca;
      border: 1px solid #c7d2fe;
    }

    /* ── Meal slot note ── */

    .meal-slot-note {
      font-size: 12px;
      color: #6b7280;
      font-style: italic;
      margin: 0;
      padding: 0 4px;
    }

    /* ── Save & Return button ── */

    .save-btn {
      align-self: flex-end;
      background: #d97706;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s;
    }

    .save-btn:hover {
      background: #b45309;
    }
  `],
})
export class TaskPlacementReviewSubstepComponent implements OnInit {
  @Output() complete = new EventEmitter<void>();

  private readonly agentService = inject(AgentService);
  private readonly stateService = inject(OnboardingStateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // ── State signals ─────────────────────────────────────────────────────────
  readonly isLoading = signal(false);
  readonly hasError = signal(false);
  readonly isEmpty = signal(false);
  readonly loadingTaskNames    = signal<string[]>([]);
  readonly loadingRoutineCount = signal<number>(0);
  /** Agent-placed one-off task entries — the only items saved as placed_tasks. */
  readonly entries = signal<PlaceTasksEntry[]>([]);
  /** Routine instances expanded from templates for preview only — NOT saved as placed_tasks.
   *  The backend expands these independently via schedule_template_ids. */
  readonly routineDisplayEntries = signal<PlaceTasksEntry[]>([]);
  readonly editState = signal<EditState | null>(null);
  readonly dayCards = signal<DayCard[]>([]);

  // ── Date picker options ───────────────────────────────────────────────────
  readonly planDates = signal<{ value: string; label: string }[]>([]);

  ngOnInit(): void {
    const taskNames = this.stateService.upcomingTaskNames();
    const period = this.stateService.planPeriod();
    const scheduleTemplates = this.stateService.scheduleTemplates();

    if ((taskNames.length === 0 && scheduleTemplates.length === 0) || period === null) {
      this.isEmpty.set(true);
      return;
    }

    // Build plan date options for the date picker
    const dates = datesBetween(period.start, period.end);
    this.planDates.set(dates.map(d => ({ value: d, label: `${getDayName(d)} ${formatDisplayDate(d)}` })));

    this.loadPlacement();
  }

  loadPlacement(): void {
    if (this.isLoading()) return;

    const taskNames = this.stateService.upcomingTaskNames();
    const period = this.stateService.planPeriod();
    if (!period) return;

    this.loadingTaskNames.set(taskNames);
    this.loadingRoutineCount.set(this.stateService.totalRoutines());
    this.isLoading.set(true);
    this.hasError.set(false);
    this.editState.set(null);

    // Expand routine templates for preview — these are display-only.
    // The backend independently expands them via schedule_template_ids.
    const routineEntries = expandTemplatesToEntries(
      this.stateService.scheduleTemplates(),
      period.start,
      period.end,
    );
    this.routineDisplayEntries.set(routineEntries);

    if (taskNames.length === 0) {
      this.entries.set([]);
      this.dayCards.set(buildDayCards([], routineEntries, period.start, period.end));
      this.isLoading.set(false);
      return;
    }

    const body: PlaceTasksRequest = {
      task_names: taskNames,
      plan_start: period.start,
      plan_end: period.end,
    };

    this.agentService.placeTasks(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.entries.set(result);
          this.dayCards.set(buildDayCards(result, routineEntries, period.start, period.end));
          this.isLoading.set(false);
        },
        error: () => {
          this.hasError.set(true);
          this.isLoading.set(false);
        },
      });
  }

  // ── Row tracking ──────────────────────────────────────────────────────────

  rowTrack(row: DayRow): string {
    if (row.kind === 'meal') return `meal-${row.label}`;
    return `${row.isRoutine ? 'routine' : 'task'}-${row.entryIndex}`;
  }

  // ── Edit actions ──────────────────────────────────────────────────────────

  openEdit(entryIndex: number): void {
    const entry = this.entries()[entryIndex];
    if (!entry) return;
    this.editState.set({
      entryIndex,
      scheduledDate: entry.scheduled_date,
      timeWindowStart: entry.time_window_start,
      durationMinutes: entry.duration_minutes,
      energyRequired: entry.energy_required,
    });
  }

  onEditDate(value: string): void {
    this.editState.update(s => s ? { ...s, scheduledDate: value } : s);
  }

  onEditTime(value: string): void {
    this.editState.update(s => s ? { ...s, timeWindowStart: value } : s);
  }

  onEditDuration(value: number): void {
    this.editState.update(s => s ? { ...s, durationMinutes: value } : s);
  }

  onEditEnergy(value: string): void {
    this.editState.update(s => s ? { ...s, energyRequired: value as EnergyLevel } : s);
  }

  saveEdit(): void {
    const edit = this.editState();
    if (!edit) return;

    const period = this.stateService.planPeriod();
    if (!period) return;

    this.entries.update(list => {
      const updated = [...list];
      const hasFixedTime = !!edit.timeWindowStart;
      updated[edit.entryIndex] = {
        ...updated[edit.entryIndex],
        scheduled_date: edit.scheduledDate,
        time_window_start: hasFixedTime ? edit.timeWindowStart : undefined,
        after_milepost: hasFixedTime ? undefined : updated[edit.entryIndex].after_milepost,
        duration_minutes: edit.durationMinutes,
        energy_required: edit.energyRequired,
      };
      return updated;
    });

    this.editState.set(null);
    this.dayCards.set(buildDayCards(this.entries(), this.routineDisplayEntries(), period.start, period.end));
  }

  removeEntry(entryIndex: number): void {
    const period = this.stateService.planPeriod();
    if (!period) return;

    this.entries.update(list => list.filter((_, i) => i !== entryIndex));
    this.editState.set(null);

    // Re-index: rebuild day cards from the updated (re-indexed) entries
    this.dayCards.set(buildDayCards(this.entries(), this.routineDisplayEntries(), period.start, period.end));
  }

  // ── Save & Return ─────────────────────────────────────────────────────────

  onSaveAndReturn(): void {
    const planEntries: PlanEntryRequest[] = this.entries().map(entry => ({
      date: entry.scheduled_date,
      task_type: entry.task_type,
      title: entry.title,
      scheduled_start: entry.time_window_start ?? '12:00',
      after_milepost: entry.after_milepost,
      duration_minutes: entry.duration_minutes,
      energy_required: entry.energy_required,
    }));

    this.stateService.setPlacedTasks(planEntries);
    this.stateService.markComplete('tasks');
    this.complete.emit();
    this.router.navigate(['/onboarding']);
  }
}
