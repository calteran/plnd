import { Component, input, output, signal } from '@angular/core';
import { MealAnchor } from '../../../../core/models/schedule';
import { TaskRowComponent } from '../task-row/task-row';
import { MealReviewPaneComponent } from '../../../day-view/components/meal-review-pane/meal-review-pane';

@Component({
  selector: 'app-meal-row',
  standalone: true,
  imports: [TaskRowComponent, MealReviewPaneComponent],
  template: `
    <div class="meal-band" [class.meal-band--skipped]="meal().status === 'skipped'">
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
        <div class="meal-controls">
          <input
            class="done-checkbox"
            type="checkbox"
            [checked]="meal().status === 'done'"
            [attr.aria-label]="'Mark ' + meal().name + ' done'"
            (change)="doneToggle.emit(meal().id)"
          />
          <button
            class="review-btn"
            [attr.aria-expanded]="reviewOpen()"
            [attr.aria-label]="'Review ' + meal().name"
            (click)="reviewOpen.set(!reviewOpen())"
          >Review</button>
        </div>
      </div>

      @if (reviewOpen()) {
        <app-meal-review-pane
          [meal]="meal()"
          [date]="date()"
          (closed)="closePane()"
          (skipped)="skipped.emit($event)"
          (doneOut)="onDoneFromPane($event)"
        />
      }

      @if (meal().duringMealTasks.length > 0) {
        <div class="during-meal">
          @for (task of meal().duringMealTasks; track task.id) {
            <app-task-row
              [item]="task"
              (toggled)="toggled.emit($event)"
              (oneShotToggled)="oneShotToggled.emit($event)"
            />
          }
        </div>
      }
    </div>
  `,
  styleUrl: './meal-row.scss'
})
export class MealRowComponent {
  readonly meal       = input.required<MealAnchor>();
  readonly date       = input.required<string>();
  readonly toggled         = output<string>();
  readonly doneToggle      = output<string>();
  readonly skipped         = output<string>();
  readonly oneShotToggled  = output<{ id: string; oneShot: boolean }>();

  readonly reviewOpen = signal(false);

  closePane(): void { this.reviewOpen.set(false); }

  onDoneFromPane(mealId: string): void {
    this.doneToggle.emit(mealId);
    this.reviewOpen.set(false);
  }
}
