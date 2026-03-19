import { Component, input, output } from '@angular/core';
import { MealAnchor } from '../../../../core/models/schedule';
import { TaskRowComponent } from '../task-row/task-row';

@Component({
  selector: 'app-meal-row',
  standalone: true,
  imports: [TaskRowComponent],
  template: `
    <div class="meal-band">
      <div class="meal-header">
        <div class="gutter">
          <span class="emoji" aria-hidden="true">{{ meal().emoji }}</span>
        </div>
        <div class="meal-info">
          <span class="meal-name">{{ meal().name }}</span>
          @if (meal().description) {
            <span class="meal-desc">{{ meal().description }}</span>
          }
        </div>
        <div class="meal-badge">
          @if (meal().status === 'done') {
            <span class="badge badge--done" aria-hidden="true">Done</span>
          } @else {
            <button
              class="badge badge--plan"
              (click)="planMeal.emit(meal().id)"
              [attr.aria-label]="'Plan ' + meal().name"
            >Plan ›</button>
          }
        </div>
      </div>
      @if (meal().duringMealTasks.length > 0) {
        <div class="during-meal">
          @for (task of meal().duringMealTasks; track task.id) {
            <app-task-row [item]="task" (toggle)="toggle.emit($event)" />
          }
        </div>
      }
    </div>
  `,
  styleUrl: './meal-row.scss'
})
export class MealRowComponent {
  readonly meal     = input.required<MealAnchor>();
  readonly toggle   = output<string>();
  readonly planMeal = output<string>();
}
