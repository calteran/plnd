import { Component, computed, inject, input } from '@angular/core';
import { DatePipe, NgClass, TitleCasePipe } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { EnergyLevel, MealSlot } from '../../../../core/models/week-plan';

// 'snack' is part of the MealSlot type but is excluded from card display — snack scheduling is deferred to a future phase
const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

@Component({
  selector: 'app-plan-day-card',
  standalone: true,
  imports: [DatePipe, NgClass, TitleCasePipe],
  styleUrl: 'plan-day-card.scss',
  template: `
    <div
      class="day-card"
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
            @for (slot of slots; track slot) {
              <div class="body-row">
                <span class="slot">{{ slot | titlecase }}</span>
                @if (getMeal(slot); as meal) {
                  <span class="val">{{ meal.title }}</span>
                } @else {
                  <span class="empty-val">—</span>
                }
              </div>
            }
          </div>
          <div>
            <div class="body-section-label">Tasks</div>
            @for (task of tasks(); track $index) {
              <div class="body-row">
                <span class="val">{{ task.title }}</span>
                <span class="energy-badge" [ngClass]="energyClass(task.energy)">
                  {{ energyLabel(task.energy) }}
                </span>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `
})
export class PlanDayCardComponent {
  readonly date = input.required<string>();

  private readonly weekPlanService = inject(WeekPlanService);
  protected expanded = false;
  protected readonly slots = MEAL_SLOTS;

  protected toggle(): void { this.expanded = !this.expanded; }

  protected readonly tasks = computed(() =>
    this.weekPlanService.scheduledTasks().filter(t => t.date === this.date())
  );
  protected readonly taskCount = computed(() => this.tasks().length);

  protected getMeal(slot: MealSlot) {
    return this.weekPlanService.scheduledMeals()[this.date()]?.[slot];
  }

  protected readonly mealCount = computed(() => this.slots.filter(s => this.getMeal(s)).length);

  // Public — called directly in spec tests via componentInstance
  energyClass(energy: EnergyLevel): string {
    return energy === 'medium' ? 'energy-med' : `energy-${energy}`;
  }

  // Public — called directly in spec tests via componentInstance
  energyLabel(energy: EnergyLevel): string {
    return energy === 'medium' ? 'med' : energy;
  }
}
