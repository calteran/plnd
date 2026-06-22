import { Component, computed, inject, input, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { DayTypesMealsService } from '../../../../core/services/day-types-meals.service';
import { EnergyLevel, PlannedTask } from '../../../../core/models/week-plan';

/** Derive the slot key from a PlannedTask (matches buildCommitRequest derivation). */
function taskSlotKey(t: PlannedTask): string {
  return t.paired_meal_name ?? t.after_anchor ?? '<sched>';
}

/** CDK drop list ID for a (date, slotKey) pair in the wizard day grid. */
function wizardDropListId(date: string, slotKey: string): string {
  return `wizard-slot-${date}-${slotKey}`;
}

@Component({
  selector: 'app-plan-day-card',
  standalone: true,
  imports: [DatePipe, TitleCasePipe, DragDropModule],
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
                  @for (task of tasksForSlot(entry.name); track task) {
                    <div
                      cdkDrag
                      [cdkDragData]="task"
                      class="body-row draggable-task"
                    >
                      <span class="val">{{ task.title }}</span>
                      <span class="energy-badge" [class]="energyClass(task.energy)">
                        {{ energyLabel(task.energy) }}
                      </span>
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
              @for (task of tasksForSlot('<sched>'); track task) {
                <div
                  cdkDrag
                  [cdkDragData]="task"
                  class="body-row draggable-task"
                >
                  <span class="val">{{ task.title }}</span>
                  <span class="energy-badge" [class]="energyClass(task.energy)">
                    {{ energyLabel(task.energy) }}
                  </span>
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

  /** Tasks in a specific slot (meal name or '<sched>' for unanchored). */
  protected tasksForSlot(slotKey: string): PlannedTask[] {
    return this.tasks().filter(t => taskSlotKey(t) === slotKey);
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
    const prevSlotKey = taskSlotKey(task);
    const newDate = this.date();

    if (prevDate === newDate && prevSlotKey === targetSlotKey) {
      // Pure reorder within the same (date, slot)
      this.weekPlanService.reorderTask(newDate, targetSlotKey, event.previousIndex, event.currentIndex);
    } else {
      // Cross-slot or cross-day: updateTaskSlot handles both date change and slot patch
      // atomically in a single signal update, preventing duplicates.
      this.weekPlanService.updateTaskSlot(task, newDate, targetSlotKey, event.currentIndex);
    }
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
