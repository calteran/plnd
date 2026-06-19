import { Component, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { MealAnchor, ScheduleTask, TaskEditPatch } from '../../../../core/models/schedule';
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
              [id]="'task-row-' + task.id"
              [class.dimmed]="isTaskDimmed(task)"
              [attr.inert]="isTaskDimmed(task) ? '' : null"
              [item]="task"
              [editing]="editingId() === task.id"
              (editRequested)="editRequested.emit($event)"
              (save)="save.emit($event)"
              (closed)="closed.emit()"
              (toggled)="toggled.emit($event)"
            />
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './meal-row.scss'
})
export class MealRowComponent {
  readonly meal       = input.required<MealAnchor>();
  readonly date       = input.required<string>();
  readonly toggled         = output<string>();
  readonly doneToggle      = output<string>();
  readonly skipped         = output<string>();

  // Inline edit contract for during-meal tasks, mirroring TaskRowComponent.
  // `editingId` is the id of the task currently being edited (null when none);
  // the matching during-meal task-row hosts `app-task-edit-form`. The day view
  // resolves the save target from its own editingId, so save re-emits the patch
  // unchanged — no id plumbing needed here.
  readonly editingId       = input<string | null>(null);
  readonly editRequested   = output<string>();
  readonly save            = output<TaskEditPatch>();
  readonly closed          = output<void>();

  readonly reviewOpen = signal(false);

  /**
   * Spotlight a during-meal task only while a *sibling* in the same meal is
   * being edited — dim and inert the others, keep the edited one lit. Gated on
   * the edit target being one of this meal's tasks so we don't double-dim: when
   * a top-level row (or another meal's task) is edited, the whole meal-row host
   * is already dimmed/inert by the day view, and stacking opacity here would
   * darken these rows past every other dimmed row.
   */
  protected isTaskDimmed(task: ScheduleTask): boolean {
    const editing = this.editingId();
    if (editing === null || editing === task.id) return false;
    return this.meal().duringMealTasks.some(t => t.id === editing);
  }

  closePane(): void { this.reviewOpen.set(false); }

  onDoneFromPane(mealId: string): void {
    this.doneToggle.emit(mealId);
    this.reviewOpen.set(false);
  }
}
