import {
  Component,
  DestroyRef,
  EventEmitter,
  OnInit,
  Output,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { AgentService } from '../../../../../core/services/agent.service';
import { OnboardingStateService } from '../../../onboarding-state.service';
import { mealsForDate } from '../../../../../core/utils/day-type-utils';
import { parseDateOnly, addDaysDateOnly } from '../../../../../core/utils/date-only';
import {
  PlaceTasksRequest,
  PlaceTasksEntry,
  PlanEntryRequest,
  EnergyLevel,
  RoutineTemplateInput,
} from '../../../../../core/models/week-plan';
import { MealPatternEntry } from '../../../../../core/models/meal-pattern';
import { OnboardingTaskLoadingComponent } from '../../../shared/onboarding-task-loading/onboarding-task-loading';

// ── Meal slot divider definitions ────────────────────────────────────────────

interface MealSlotDivider {
  kind: 'meal';
  id: string;
  label: string;
}

interface TaskRow {
  kind: 'task';
  entry: PlaceTasksEntry;
  entryIndex: number;
}

type DayRow = MealSlotDivider | TaskRow;

interface DayCard {
  date: string;        // ISO date
  displayDate: string; // e.g. "Apr 28"
  dayName: string;     // e.g. "MONDAY"
  rows: DayRow[];
}

// ── CDK drag-drop section structure ──────────────────────────────────────────

/**
 * A section within a day card corresponding to one drop list.
 * slotKey is either a meal name (for meal-associated tasks) or '<sched>'
 * (for unanchored tasks).
 */
interface DaySection {
  /** CDK drop list ID */
  dropListId: string;
  /** Meal label (e.g. "BREAKFAST") if this is a meal section; null for unanchored */
  mealLabel: string | null;
  /** The slot key: meal name or '<sched>' */
  slotKey: string;
  /** Tasks belonging to this section */
  taskRows: TaskRow[];
}

interface DayCardSections {
  date: string;
  displayDate: string;
  dayName: string;
  sections: DaySection[];
}

// ── Edit state ───────────────────────────────────────────────────────────────

interface EditState {
  entryIndex: number;
  title: string;
  scheduledDate: string;
  timeWindowStart: string | undefined;
  durationMinutes: number;
  energyRequired: EnergyLevel;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = addDaysDateOnly(current, 1);
  }
  return dates;
}

function formatDisplayDate(isoDate: string): string {
  const d = parseDateOnly(isoDate);
  return `${MONTH_ABBREVS[d.getMonth()]} ${d.getDate()}`;
}

function getDayName(isoDate: string): string {
  return DAY_NAMES[parseDateOnly(isoDate).getDay()];
}

type Bucket = 'start-of-day' | 'morning' | 'afternoon' | 'evening';

export function bucketOf(entry: PlaceTasksEntry, anchorNames: Set<string>): Bucket {
  if (entry.after_anchor) {
    const lower = entry.after_anchor.toLowerCase();
    // The implicit start-of-day anchor (§4.7) — a task placed in the slot above
    // the first meal divider. The LLM emits this label per place_tasks.md.
    if (lower === 'start of day') return 'start-of-day';
    // If after_anchor matches a known pattern entry name (case-insensitive), bucket by name keyword.
    if (anchorNames.has(lower)) {
      if (lower.includes('breakfast') || lower.includes('morning')) return 'morning';
      if (lower.includes('dinner') || lower.includes('supper') || lower.includes('evening')) return 'evening';
      return 'afternoon';
    }
  }
  // Fixed tasks: bucket by wall-clock time
  const t = entry.time_window_start ?? '12:00';
  if (t < '12:00') return 'morning';
  if (t < '17:00') return 'afternoon';
  return 'evening';
}

export function buildDayCards(
  entries: PlaceTasksEntry[],
  start: string,
  end: string,
  getMeals: (date: string) => MealPatternEntry[],
): DayCard[] {
  const allDates = datesBetween(start, end);
  return allDates.map(date => {
    const pattern = getMeals(date);
    const anchorNames = new Set(pattern.map(p => p.name.toLowerCase()));
    const dayEntries = entries
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => entry.scheduled_date === date);

    const bySlot = (slot: Bucket): TaskRow[] =>
      dayEntries
        .filter(({ entry }) => bucketOf(entry, anchorNames) === slot)
        .sort((a, b) => (a.entry.time_window_start ?? '').localeCompare(b.entry.time_window_start ?? ''))
        .map(({ entry, idx }) => ({
          kind: 'task' as const,
          entry,
          entryIndex: idx,
        }));

    const rows: DayRow[] = [];
    if (pattern.length === 0) {
      rows.push(
        ...bySlot('start-of-day'),
        ...bySlot('morning'),
        ...bySlot('afternoon'),
        ...bySlot('evening'),
      );
    } else {
      // Tasks anchored at start-of-day render above the first meal divider.
      rows.push(...bySlot('start-of-day'));
      const buckets: ('morning' | 'afternoon' | 'evening')[] = pattern.map(p => {
        const lower = p.name.toLowerCase();
        if (lower.includes('breakfast') || lower.includes('morning')) return 'morning';
        if (lower.includes('dinner') || lower.includes('supper') || lower.includes('evening')) return 'evening';
        return 'afternoon';
      });
      const consumed = new Set<'morning' | 'afternoon' | 'evening'>();
      pattern.forEach((p, i) => {
        rows.push({ kind: 'meal', id: p.id, label: p.name.toUpperCase() });
        const bucket = buckets[i];
        if (!consumed.has(bucket)) {
          rows.push(...bySlot(bucket));
          consumed.add(bucket);
        }
      });
      (['morning', 'afternoon', 'evening'] as const).forEach(b => {
        if (!consumed.has(b)) rows.push(...bySlot(b));
      });
    }

    return {
      date,
      displayDate: formatDisplayDate(date),
      dayName: getDayName(date),
      rows,
    };
  });
}

/** CDK drop list ID for an onboarding placement slot (date + slotKey). */
export function onboardingDropListId(date: string, slotKey: string): string {
  return `onboarding-slot-${date}-${slotKey}`;
}

/** Derive the slot key for an entry. Mirrors toPlanEntries slotKey derivation. */
function entrySlotKey(entry: PlaceTasksEntry): string {
  return entry.paired_meal_name ?? entry.after_anchor ?? '<sched>';
}

/**
 * Build CDK-friendly section groups for a day card.
 * Each section maps to one cdkDropList. Meals from the pattern each get their own
 * section; tasks are placed into the section whose slotKey matches the task's
 * entrySlotKey. Unmatched tasks fall into the '<sched>' section.
 */
function buildDaySections(
  date: string,
  entries: PlaceTasksEntry[],
  pattern: MealPatternEntry[],
): DaySection[] {
  const dayEntries = entries
    .map((entry, idx) => ({ entry, idx }))
    .filter(({ entry }) => entry.scheduled_date === date);

  const mealNames = pattern.map(p => p.name.toLowerCase());

  const sections: DaySection[] = [];

  // Unanchored / fixed-time section (always present)
  const schedSection: DaySection = {
    dropListId: onboardingDropListId(date, '<sched>'),
    mealLabel: null,
    slotKey: '<sched>',
    taskRows: [],
  };

  const mealSections = new Map<string, DaySection>();
  for (const p of pattern) {
    const slotKey = p.name.toLowerCase();
    const section: DaySection = {
      dropListId: onboardingDropListId(date, slotKey),
      mealLabel: p.name.toUpperCase(),
      slotKey,
      taskRows: [],
    };
    mealSections.set(slotKey, section);
    sections.push(section);
  }

  // Bucket tasks into sections
  for (const { entry, idx } of dayEntries) {
    const sk = entrySlotKey(entry);
    const taskRow: TaskRow = { kind: 'task', entry, entryIndex: idx };
    if (mealSections.has(sk)) {
      mealSections.get(sk)!.taskRows.push(taskRow);
    } else if (mealNames.includes(sk)) {
      // after_anchor matches a meal name — pair it with that meal's section
      const section = mealSections.get(sk);
      if (section) {
        section.taskRows.push(taskRow);
      } else {
        schedSection.taskRows.push(taskRow);
      }
    } else {
      schedSection.taskRows.push(taskRow);
    }
  }

  // Prepend the unanchored section (always first)
  sections.unshift(schedSection);
  return sections;
}

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-task-placement-review-substep',
  standalone: true,
  imports: [OnboardingTaskLoadingComponent, DragDropModule],
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
        <app-onboarding-task-loading
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
          @for (card of daySections(); track card.date) {
            <div class="day-card">
              <!-- Card header -->
              <div class="day-header">
                <span class="day-name">{{ card.dayName }}</span>
                <span class="day-date">{{ card.displayDate }}</span>
              </div>

              <!-- Sections: each section is a cdkDropList -->
              @for (section of card.sections; track section.slotKey) {
                @if (section.mealLabel) {
                  <div class="meal-divider">
                    <span class="meal-label">{{ section.mealLabel }}</span>
                    <em class="meal-placeholder">&mdash;</em>
                  </div>
                }
                <div
                  cdkDropList
                  [id]="section.dropListId"
                  [cdkDropListData]="section.taskRows"
                  [cdkDropListConnectedTo]="allDropListIds()"
                  (cdkDropListDropped)="onDrop($event, card.date, section.slotKey)"
                  class="section-drop-list"
                >
                  @for (row of section.taskRows; track rowTrack(row)) {
                    <div cdkDrag [cdkDragData]="row.entry" class="task-drag-item">
                      @if (editState() && editState()!.entryIndex === row.entryIndex) {
                        <!-- Edit form -->
                        <div class="task-row task-row--editing">
                          <div class="edit-form">
                            <label class="edit-field">
                              <span class="edit-label">Name</span>
                              <input
                                type="text"
                                class="edit-input"
                                [value]="editState()!.title"
                                (input)="onEditTitle($any($event.target).value)"
                                aria-label="Task name"
                              />
                            </label>
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
                        <div class="task-row">
                          @if (row.entry.time_window_start) {
                            <span class="task-time">{{ row.entry.time_window_start }}</span>
                          }
                          <span class="task-title">{{ row.entry.title }}</span>
                          <div class="task-meta">
                            <span class="energy-badge energy-badge--{{ row.entry.energy_required }}">
                              {{ row.entry.energy_required }}
                            </span>
                            <button
                              type="button"
                              class="edit-btn"
                              (click)="openEdit(row.entryIndex)"
                              [attr.aria-label]="'Edit ' + row.entry.title"
                            >Edit</button>
                          </div>
                        </div>
                      }
                    </div>
                  }
                </div>
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
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      color: var(--color-text-muted);
    }

    .error-msg {
      color: var(--color-destructive);
    }

    .retry-btn {
      background: none;
      border: 1.5px solid var(--color-border-input);
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 13px;
      cursor: pointer;
      color: var(--color-text-body);
    }

    .retry-btn:hover {
      border-color: var(--color-accent);
      color: var(--color-accent);
    }

    /* ── Day grid ── */

    .day-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .day-card {
      border: 1.5px solid var(--color-accent-border);
      border-radius: 10px;
      overflow: hidden;
      background: var(--color-surface-white);
    }

    .day-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 10px 14px;
      background: var(--color-accent-light);
    }

    .day-name {
      font-size: 13px;
      font-weight: 800;
      color: var(--color-text-primary);
      letter-spacing: 0.04em;
    }

    .day-date {
      font-size: 12px;
      color: var(--color-accent-dark);
    }

    /* ── Meal dividers ── */

    .meal-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 14px;
      background: var(--color-accent-light);
      border-top: 1px solid var(--color-accent-border);
    }

    .meal-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--color-text-primary);
      letter-spacing: 0.06em;
      min-width: 72px;
    }

    .meal-placeholder {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    /* ── Drop list sections ── */

    .section-drop-list {
      min-height: 4px;
    }

    /* ── Task rows ── */

    .task-drag-item {
      cursor: grab;
    }

    .task-drag-item:active {
      cursor: grabbing;
    }

    .task-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      border-top: 1px solid var(--color-border-row);
      gap: 8px;
    }

    .task-row--editing {
      background: var(--color-surface-white);
      border-left: 3px solid var(--color-accent);
      padding-left: 11px;
    }

    .task-time {
      color: var(--color-accent);
      font-weight: 700;
      font-size: 11px;
      margin-right: 6px;
    }

    .task-title {
      font-size: 13px;
      color: var(--color-text-body);
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
      background: color-mix(in srgb, var(--color-energy-low) 12%, transparent);
      color: var(--color-energy-low);
    }

    .energy-badge--medium {
      background: color-mix(in srgb, var(--color-energy-medium) 12%, transparent);
      color: var(--color-energy-medium);
    }

    .energy-badge--high {
      background: color-mix(in srgb, var(--color-energy-high) 12%, transparent);
      color: var(--color-energy-high);
    }

    .edit-btn {
      background: none;
      border: 1.5px solid var(--color-border-input);
      border-radius: 5px;
      padding: 3px 9px;
      font-size: 12px;
      cursor: pointer;
      color: var(--color-btn-neutral-text);
    }

    .edit-btn:hover {
      border-color: var(--color-accent);
      color: var(--color-accent);
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
      color: var(--color-text-primary);
    }

    .edit-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--color-text-primary);
    }

    .edit-input {
      border: 1.5px solid var(--color-accent-border);
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
      border-color: var(--color-accent);
    }

    .edit-actions {
      display: flex;
      gap: 8px;
      padding-top: 4px;
    }

    .save-edit-btn {
      background: var(--color-accent);
      color: var(--color-btn-accent-text);
      border: none;
      border-radius: 6px;
      padding: 6px 16px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .save-edit-btn:hover {
      background: var(--color-accent-dark);
    }

    .remove-edit-btn {
      background: none;
      border: 1.5px solid var(--color-border-input);
      border-radius: 6px;
      padding: 6px 16px;
      font-size: 13px;
      cursor: pointer;
      color: var(--color-btn-neutral-text);
    }

    .remove-edit-btn:hover {
      border-color: var(--color-destructive);
      color: var(--color-destructive);
    }

    /* ── Meal slot note ── */

    .meal-slot-note {
      font-size: 12px;
      color: var(--color-text-muted);
      font-style: italic;
      margin: 0;
      padding: 0 4px;
    }

    /* ── Save & Return button ── */

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
      transition: background 0.15s;
    }

    .save-btn:hover {
      background: var(--color-accent-dark);
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
  readonly entries = signal<PlaceTasksEntry[]>([]);
  readonly editState = signal<EditState | null>(null);

  // ── Date picker options ───────────────────────────────────────────────────
  readonly planDates = signal<{ value: string; label: string }[]>([]);

  /** Section-grouped view of entries per day card (used by the CDK drag template). */
  readonly daySections = computed((): DayCardSections[] => {
    const period = this.stateService.planPeriod();
    if (!period) return [];
    const dates = datesBetween(period.start, period.end);
    const entriesSnap = this.entries();
    return dates.map(date => {
      const pattern = mealsForDate(date, this.stateService.dayTypes());
      const sections = buildDaySections(date, entriesSnap, pattern);
      return {
        date,
        displayDate: formatDisplayDate(date),
        dayName: getDayName(date),
        sections,
      };
    });
  });

  /**
   * All CDK drop list IDs across the full horizon (for cross-day and same-day
   * connections). A list's own ID appearing in its own connectedTo is a harmless
   * CDK no-op, so we include all IDs unconditionally — excluding same-day siblings
   * would break same-day cross-slot drops.
   */
  readonly allDropListIds = computed((): string[] => {
    return this.daySections().flatMap(card =>
      card.sections.map(s => s.dropListId)
    );
  });

  ngOnInit(): void {
    const taskNames = this.stateService.upcomingTaskNames();
    const period = this.stateService.planPeriod();
    const routines = this.stateService.routines();

    if ((taskNames.length === 0 && routines.length === 0) || period === null) {
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

    const routineTemplates: RoutineTemplateInput[] = this.stateService.routines()
      .filter(t => t.recurrence_rule !== null)
      .map(t => ({
        title: t.title,
        task_type: t.task_type,
        recurrence_rule: t.recurrence_rule!,
        duration_minutes: t.duration_minutes ?? 30,
        energy_required: t.energy_required,
        time_window_start: t.time_window_start ?? undefined,
        time_window_end: t.time_window_end ?? undefined,
      }));

    this.loadingTaskNames.set(taskNames);
    this.loadingRoutineCount.set(this.stateService.totalRoutines());
    this.isLoading.set(true);
    this.hasError.set(false);
    this.editState.set(null);

    const body: PlaceTasksRequest = {
      task_names: taskNames,
      routine_templates: routineTemplates,
      plan_start: period.start,
      plan_end: period.end,
    };

    this.agentService.placeTasks(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.entries.set(result);
          this.isLoading.set(false);
        },
        error: () => {
          this.hasError.set(true);
          this.isLoading.set(false);
        },
      });
  }

  // ── Row tracking ──────────────────────────────────────────────────────────

  rowTrack(row: TaskRow): string {
    return `task-${row.entryIndex}`;
  }

  // ── Edit actions ──────────────────────────────────────────────────────────

  openEdit(entryIndex: number): void {
    const entry = this.entries()[entryIndex];
    if (!entry) return;
    this.editState.set({
      entryIndex,
      title: entry.title,
      scheduledDate: entry.scheduled_date,
      timeWindowStart: entry.time_window_start,
      durationMinutes: entry.duration_minutes,
      energyRequired: entry.energy_required,
    });
  }

  onEditTitle(value: string): void {
    this.editState.update(s => s ? { ...s, title: value } : s);
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

    this.entries.update(list => {
      const updated = [...list];
      const hasFixedTime = !!edit.timeWindowStart;
      updated[edit.entryIndex] = {
        ...updated[edit.entryIndex],
        title: edit.title.trim(),
        scheduled_date: edit.scheduledDate,
        time_window_start: hasFixedTime ? edit.timeWindowStart : undefined,
        after_anchor: hasFixedTime ? undefined : updated[edit.entryIndex].after_anchor,
        duration_minutes: edit.durationMinutes,
        energy_required: edit.energyRequired,
      };
      return updated;
    });

    this.editState.set(null);
  }

  removeEntry(entryIndex: number): void {
    this.entries.update(list => list.filter((_, i) => i !== entryIndex));
    this.editState.set(null);
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  /**
   * Handle a CDK drop into a slot section.
   * - If same date AND same slot: pure reorder within the section.
   * - Otherwise: cross-slot or cross-day move — update date + slot atomically
   *   in a single signal mutation to prevent duplicate entries.
   */
  onDrop(event: CdkDragDrop<TaskRow[]>, targetDate: string, targetSlotKey: string): void {
    const droppedEntry: PlaceTasksEntry = event.item.data;

    this.entries.update(list => {
      // Find the dropped entry's current index by reference identity
      const fromIdx = list.indexOf(droppedEntry);
      if (fromIdx === -1) return list;

      // Build the fully updated entry in one step (atomic: date + slot)
      const updatedEntry: PlaceTasksEntry = {
        ...droppedEntry,
        scheduled_date: targetDate,
        // Clear both slot fields first, then set the appropriate one
        after_anchor: undefined,
        paired_meal_name: undefined,
        ...(targetSlotKey !== '<sched>'
          ? { paired_meal_name: targetSlotKey }
          : {}),
      };

      // Remove from old position, insert at new position
      const updated = [...list];
      updated.splice(fromIdx, 1);

      // Insert at the CDK-computed index within the target slot. This handles
      // same-slot reorder AND cross-slot/cross-day moves identically, so a task
      // can be dropped into a specific position even when changing slot/day
      // (consistent with WeekPlanService.updateTaskSlot, which also honours
      // currentIndex).
      const slotEntries = updated
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.scheduled_date === targetDate && entrySlotKey(e) === targetSlotKey);

      const insertAtSlotIdx = Math.min(event.currentIndex, slotEntries.length);
      const insertAtListIdx = insertAtSlotIdx < slotEntries.length
        ? slotEntries[insertAtSlotIdx].i
        : (slotEntries.length > 0 ? slotEntries[slotEntries.length - 1].i + 1 : updated.length);
      updated.splice(insertAtListIdx, 0, updatedEntry);

      return updated;
    });
  }

  // ── Save & Return ─────────────────────────────────────────────────────────

  /**
   * Map entries to PlanEntryRequest[], deriving contiguous slot_position per
   * (scheduled_date, slotKey) group from the entries array order.
   * slotKey = paired_meal_name ?? after_anchor ?? '<sched>'
   */
  toPlanEntries(): PlanEntryRequest[] {
    const posByGroup = new Map<string, number>();
    return this.entries().map(entry => {
      const slotKey = `${entry.scheduled_date}::${entry.paired_meal_name ?? entry.after_anchor ?? '<sched>'}`;
      const pos = posByGroup.get(slotKey) ?? 0;
      posByGroup.set(slotKey, pos + 1);
      return {
        date: entry.scheduled_date,
        task_type: entry.task_type,
        title: entry.title,
        scheduled_start: entry.after_anchor || entry.paired_meal_name ? null : (entry.time_window_start ?? null),
        after_anchor: entry.paired_meal_name ? undefined : entry.after_anchor,
        paired_meal_name: entry.paired_meal_name,
        duration_minutes: entry.duration_minutes,
        energy_required: entry.energy_required,
        slot_position: pos,
      };
    });
  }

  onSaveAndReturn(): void {
    const planEntries = this.toPlanEntries();
    this.stateService.setPlacedTasks(planEntries);
    this.stateService.markComplete('tasks');
    this.complete.emit();
    this.router.navigate(['/onboarding']);
  }
}
