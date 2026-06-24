import { Component, computed, inject, input, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { DayTypesMealsService } from '../../../../core/services/day-types-meals.service';
import { EnergyLevel, PlannedTask } from '../../../../core/models/week-plan';
import { slotKeysMatch, slotMatchKey } from '../../../../core/utils/slot-key';
import {
  stepWithinDay,
  describeMove,
  describeDayJump,
  DayLayout,
} from '../../../../core/utils/reorder-navigation';
import { parseDateOnly } from '../../../../core/utils/date-only';
import { ReorderControlsComponent } from '../../../schedule/components/reorder-controls/reorder-controls';

/** CDK drop list ID for a (date, slotKey) pair in the wizard day grid. */
function wizardDropListId(date: string, slotKey: string): string {
  return `wizard-slot-${date}-${slotKey}`;
}

@Component({
  selector: 'app-plan-day-card',
  standalone: true,
  imports: [DatePipe, TitleCasePipe, DragDropModule, ReorderControlsComponent],
  styleUrl: 'plan-day-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="day-card"
      role="button"
      [attr.aria-expanded]="expanded"
      [class.expanded]="expanded"
      (click)="toggle()"
      tabindex="0"
      (keydown.enter)="toggle()"
      (keydown.space)="$event.preventDefault(); toggle()"
    >
      <div class="card-header">
        <span class="day-name">{{ date() | date:'EEE' }}</span>
        <span class="day-date">{{ date() | date:'MMM d' }}</span>
      </div>
      <div class="card-stats">
        <div class="stat-row">
          <span class="stat-label">tasks</span>
          <span class="stat-val" [class.zero]="taskCount() === 0">{{ taskCount() }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">meals</span>
          <span class="stat-val" [class.zero]="mealCount() === 0">{{ mealCount() }}</span>
        </div>
      </div>
      <span class="card-chevron">▾</span>
      <div class="card-body">
        <div class="card-body-inner">
          <div>
            <div class="body-section-label">Meals</div>
            @for (entry of slots(); track entry.id) {
              <div class="body-row">
                <span class="slot">{{ entry.name | titlecase }}</span>
                @if (getMeal(entry.name); as meal) {
                  <span class="val">{{ meal.title }}</span>
                } @else {
                  <span class="empty-val">—</span>
                }
                <!-- Drop list for tasks paired with this meal slot -->
                <div
                  cdkDropList
                  [id]="dropListId(entry.name)"
                  [cdkDropListData]="tasksForSlot(entry.name)"
                  [cdkDropListConnectedTo]="allDropListIds()"
                  (cdkDropListDropped)="onDrop($event, entry.name)"
                  class="slot-drop-list meal-slot-drop-list"
                >
                  @for (task of tasksForSlot(entry.name); track $index; let i = $index) {
                    <div
                      cdkDrag
                      [cdkDragData]="task"
                      class="body-row draggable-task"
                      [id]="rowDomId(entry.name, i)"
                      tabindex="0"
                      [attr.aria-label]="task.title"
                      (click)="$event.stopPropagation()"
                      (keydown)="$event.stopPropagation()"
                    >
                      <span class="val">{{ task.title }}</span>
                      <span class="energy-badge" [class]="energyClass(task.energy)">
                        {{ energyLabel(task.energy) }}
                      </span>
                      <app-reorder-controls
                        [label]="task.title"
                        [canUp]="caps(entry.name, i).up"
                        [canDown]="caps(entry.name, i).down"
                        [canPrevDay]="!isFirstDay()"
                        [canNextDay]="!isLastDay()"
                        (up)="onMove(entry.name, i, 'up')"
                        (down)="onMove(entry.name, i, 'down')"
                        (prevDay)="onDayJump(task, -1)"
                        (nextDay)="onDayJump(task, 1)"
                      />
                    </div>
                  }
                </div>
              </div>
            }
          </div>
          <div>
            <div class="body-section-label">Tasks</div>
            <!-- Drop list for tasks not assigned to a meal slot -->
            <div
              cdkDropList
              [id]="dropListId('<sched>')"
              [cdkDropListData]="tasksForSlot('<sched>')"
              [cdkDropListConnectedTo]="allDropListIds()"
              (cdkDropListDropped)="onDrop($event, '<sched>')"
              class="slot-drop-list"
            >
              @for (task of tasksForSlot('<sched>'); track $index; let i = $index) {
                <div
                  cdkDrag
                  [cdkDragData]="task"
                  class="body-row draggable-task"
                  [id]="rowDomId('<sched>', i)"
                  tabindex="0"
                  [attr.aria-label]="task.title"
                  (click)="$event.stopPropagation()"
                  (keydown)="$event.stopPropagation()"
                >
                  <span class="val">{{ task.title }}</span>
                  <span class="energy-badge" [class]="energyClass(task.energy)">
                    {{ energyLabel(task.energy) }}
                  </span>
                  <app-reorder-controls
                    [label]="task.title"
                    [canUp]="caps('<sched>', i).up"
                    [canDown]="caps('<sched>', i).down"
                    [canPrevDay]="!isFirstDay()"
                    [canNextDay]="!isLastDay()"
                    (up)="onMove('<sched>', i, 'up')"
                    (down)="onMove('<sched>', i, 'down')"
                    (prevDay)="onDayJump(task, -1)"
                    (nextDay)="onDayJump(task, 1)"
                  />
                </div>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class PlanDayCardComponent {
  readonly date = input.required<string>();
  /** All dates in the wizard horizon — used to compute cross-day connected drop list IDs. */
  readonly horizonDays = input<string[]>([]);

  private readonly weekPlanService = inject(WeekPlanService);
  private readonly dayTypesMealsService = inject(DayTypesMealsService);
  private readonly announcer = inject(LiveAnnouncer);
  protected expanded = false;
  protected readonly slots = computed(() => this.dayTypesMealsService.mealsForDate(this.date()));

  protected toggle(): void { this.expanded = !this.expanded; }

  protected readonly tasks = computed(() =>
    this.weekPlanService.scheduledTasks().filter(t => t.date === this.date())
  );
  protected readonly taskCount = computed(() => this.tasks().length);

  protected getMeal(slot: string) {
    return this.weekPlanService.scheduledMeals()[this.date()]?.[slot];
  }

  protected readonly mealCount = computed(() => this.slots().filter(s => this.getMeal(s.name)).length);

  /** Tasks in a specific slot (meal name or '<sched>' for unanchored), matched case-insensitively. */
  protected tasksForSlot(slotKey: string): PlannedTask[] {
    return this.tasks().filter(t => slotKeysMatch(t, slotKey));
  }

  /** CDK drop list ID for a slot on this card's date. */
  protected dropListId(slotKey: string): string {
    return wizardDropListId(this.date(), slotKey);
  }

  /**
   * All CDK drop list IDs across the full horizon (for cross-day and same-day connections).
   * Each date uses that date's own meal slots so IDs match the actual drop lists rendered
   * on each card. The current card's own IDs ARE included — a list's own ID in its own
   * `connectedTo` is a harmless no-op in CDK, and excluding them would break same-day
   * cross-slot drops (e.g. dragging a task from <sched> into a meal slot on the same card).
   */
  protected readonly allDropListIds = computed((): string[] => {
    const ids: string[] = [];
    for (const date of this.horizonDays()) {
      // Meal-paired slots for this specific date
      for (const s of this.dayTypesMealsService.mealsForDate(date)) {
        ids.push(wizardDropListId(date, s.name));
      }
      // Unanchored task slot per date
      ids.push(wizardDropListId(date, '<sched>'));
    }
    return ids;
  });

  protected onDrop(event: CdkDragDrop<PlannedTask[]>, targetSlotKey: string): void {
    const task: PlannedTask = event.item.data;
    const prevDate = task.date;
    const newDate = this.date();
    // Compare slots case-insensitively; pass the raw targetSlotKey to the service so
    // paired_meal_name keeps the rendered meal's display casing.
    const sameSlot = slotKeysMatch(task, targetSlotKey);

    if (prevDate === newDate && sameSlot) {
      // Pure reorder within the same (date, slot)
      this.weekPlanService.reorderTask(newDate, targetSlotKey, event.previousIndex, event.currentIndex);
    } else {
      // Cross-slot or cross-day: updateTaskSlot handles both date change and slot patch
      // atomically in a single signal update, preventing duplicates.
      this.weekPlanService.updateTaskSlot(task, newDate, targetSlotKey, event.currentIndex);
    }
  }

  // ── Keyboard reorder + cross-day jump ───────────────────────────────────────

  /** A document-global DOM id for a row's reorder control, keyed by (date, slot, index). */
  protected rowDomId(slotKey: string, i: number): string {
    return `wizard-reorder-${this.date()}-${slotKey}-${i}`;
  }

  /** Slot keys in template reading order: each meal slot, then the unanchored <sched> slot. */
  private dayLayout(): DayLayout {
    const slots = this.slots().map(s => s.name).concat('<sched>');
    return slots.map(slotKey => ({
      slotKey,
      kind: slotKey === '<sched>' ? 'slot' as const : 'meal' as const,
      taskIds: this.tasksForSlot(slotKey).map((_t, i) => `${slotKey}#${i}`),
    }));
  }

  /** Whether the up/down controls are enabled for a row (boundary detection). */
  protected caps(slotKey: string, i: number): { up: boolean; down: boolean } {
    const id = `${slotKey}#${i}`;
    const layout = this.dayLayout();
    return {
      up: stepWithinDay(layout, id, 'up') !== null,
      down: stepWithinDay(layout, id, 'down') !== null,
    };
  }

  protected isFirstDay(): boolean { return this.horizonDays()[0] === this.date(); }
  protected isLastDay(): boolean { return this.horizonDays().at(-1) === this.date(); }

  /** Human-readable label for a slot key in announcements ('Tasks' for the unanchored slot). */
  private slotLabel(slotKey: string): string {
    return slotKey === '<sched>' ? 'Tasks' : slotKey;
  }

  /**
   * Friendly day label for announcements, e.g. "Wed Mar 20".
   * Matches the card header style (EEE + MMM d) rather than a raw ISO string,
   * so screen readers hear "Wed Mar 20" instead of "2026-03-20".
   */
  private dayLabel(isoDate: string): string {
    const d = parseDateOnly(isoDate);
    const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${DAY_ABBREVS[d.getDay()]} ${MONTH_ABBREVS[d.getMonth()]} ${d.getDate()}`;
  }

  /** Step a task one position earlier/later within its day, then announce + refocus. */
  protected onMove(slotKey: string, i: number, dir: 'up' | 'down'): void {
    const result = stepWithinDay(this.dayLayout(), `${slotKey}#${i}`, dir);
    if (!result) return;
    const task = this.tasksForSlot(slotKey)[i];
    if (!task) return;

    if (result.crossing === 'same-slot') {
      this.weekPlanService.reorderTask(this.date(), slotKey, i, result.index);
    } else {
      this.weekPlanService.updateTaskSlot(task, this.date(), result.slotKey, result.index);
    }

    this.announcer.announce(describeMove({
      crossing: result.crossing,
      dir,
      targetLabel: this.slotLabel(result.slotKey),
      sourceLabel: this.slotLabel(slotKey),
    }), 'polite');

    this.refocusReorderButton(result.slotKey, result.index, dir);
  }

  /** Move a task to the previous/next day, into the same slot if present else unanchored. */
  protected onDayJump(task: PlannedTask, delta: -1 | 1): void {
    const days = this.horizonDays();
    const targetDate = days[days.indexOf(this.date()) + delta];
    if (!targetDate) return;

    const targetKeys = this.dayTypesMealsService.mealsForDate(targetDate).map(s => s.name).concat('<sched>');
    // Match the task's slot to the target day case-insensitively (#1005 casing
    // contract), but land it in that day's slot key in ITS display casing so the
    // emitted paired_meal_name matches the rendered meal. Falls back to unanchored.
    const taskKey = slotMatchKey(task);
    const targetSlot = targetKeys.find(k => k.toLowerCase() === taskKey) ?? '<sched>';
    const endIndex = this.weekPlanService.scheduledTasks()
      .filter(t => t.date === targetDate && slotKeysMatch(t, targetSlot)).length;

    this.weekPlanService.updateTaskSlot(task, targetDate, targetSlot, endIndex);

    this.announcer.announce(describeDayJump({
      dayLabel: this.dayLabel(targetDate),
      targetLabel: targetSlot === '<sched>' ? undefined : targetSlot,
    }), 'polite');

    // The task moved to ANOTHER card that may be collapsed (not rendered). Attempt to
    // focus its new control on the target card; if absent, focus gracefully degrades to
    // the current card's nearest control — never throws, never drops focus to <body>.
    // (Day-jump focus-follow into a collapsed target card is a documented v1 limitation.)
    this.refocusReorderButton(targetSlot, endIndex, delta === 1 ? 'down' : 'up', targetDate);
  }

  /**
   * Re-focus the moved task's reorder control after the re-render. The buttons are
   * `visibility: hidden` until the row gains `:focus-within`, so we FIRST focus the
   * always-visible row element (now `tabindex=0`) to reveal them, then focus the
   * preferred direction button; if it is disabled at a boundary, fall back to its
   * sibling, else leave focus on the row. Deferred with setTimeout(0) so Angular has
   * applied the `[disabled]` bindings before we read them.
   *
   * NOTE: this only works because the task `@for` loops `track $index` (position-
   * based), so a reorder updates the existing row node IN PLACE. Tracking by object
   * identity would make Angular physically MOVE the moved task's DOM node (detach +
   * reattach), which drops focus to <body> and races this deferred re-focus.
   */
  private refocusReorderButton(
    slotKey: string,
    index: number,
    dir: 'up' | 'down',
    date: string = this.date(),
  ): void {
    setTimeout(() => {
      const rowId = `wizard-reorder-${date}-${slotKey}-${index}`;
      const row = document.getElementById(rowId);
      if (!row) return; // Collapsed target card (day jump) — leave focus as-is.

      // Reveal the controls: focus the always-visible row to set :focus-within.
      row.focus();

      const same = row.querySelector<HTMLButtonElement>(`[data-testid="reorder-${dir}"]`);
      if (same && !same.disabled) { same.focus(); return; }
      const other = row.querySelector<HTMLButtonElement>(
        `[data-testid="reorder-${dir === 'up' ? 'down' : 'up'}"]`,
      );
      if (other && !other.disabled) { other.focus(); return; }
      // Both disabled — leave focus on the row we already focused.
    }, 0);
  }

  // Public — called directly in spec tests via componentInstance
  energyClass(energy: EnergyLevel): string {
    return `energy-${energy}`;
  }

  // Public — called directly in spec tests via componentInstance
  energyLabel(energy: EnergyLevel): string {
    return energy === 'medium' ? 'med' : energy;
  }
}
