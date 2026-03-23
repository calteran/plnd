import { Component, Input, inject } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { MealSlot } from '../../../../core/models/week-plan';

const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

@Component({
  selector: 'app-plan-day-card',
  standalone: true,
  imports: [TitleCasePipe],
  template: `
    <div class="day-card" [class.expanded]="expanded" (click)="toggle()">
      <div class="card-header">
        <strong>{{ date }}</strong>
        <span class="task-count">{{ taskCount }} task(s)</span>
        <span class="meal-count">{{ mealCount }} meal(s)</span>
      </div>
      @if (expanded) {
        <div class="card-body">
          <h4>Meals</h4>
          <ul>
            @for (slot of slots; track slot) {
              @if (getMeal(slot); as meal) {
                <li>{{ slot | titlecase }}: {{ meal.title }}</li>
              } @else {
                <li class="empty-slot">{{ slot | titlecase }}: —</li>
              }
            }
          </ul>
          <h4>Tasks</h4>
          <ul>
            @for (task of tasks; track $index) {
              <li>{{ task.title }} ({{ task.energy }})</li>
            }
          </ul>
        </div>
      }
    </div>
  `
})
export class PlanDayCardComponent {
  @Input({ required: true }) date!: string;

  private readonly weekPlanService = inject(WeekPlanService);
  expanded = false;
  readonly slots = MEAL_SLOTS;

  toggle(): void { this.expanded = !this.expanded; }

  get tasks() { return this.weekPlanService.scheduledTasks().filter(t => t.date === this.date); }
  get taskCount() { return this.tasks.length; }
  getMeal(slot: MealSlot) { return this.weekPlanService.scheduledMeals()[this.date]?.[slot]; }
  get mealCount() { return this.slots.filter(s => this.getMeal(s)).length; }
}
