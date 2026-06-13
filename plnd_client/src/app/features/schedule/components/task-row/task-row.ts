import { Component, computed, input, output } from '@angular/core';
import { ItemType, ScheduleTask } from '../../../../core/models/schedule';

const TYPE_BADGE_LABELS: Partial<Record<ItemType, string>> = {
  work:        'work',
  exercise:    'exercise',
  leisure:     'leisure',
  medication:  'rx',
  appointment: 'appt',
};

@Component({
  selector: 'app-task-row',
  standalone: true,
  template: `
    <div class="task-row" [class.done]="item().status === 'done'">
      <div class="gutter">
        @if (item().scheduledTime) {
          <span class="time">{{ item().scheduledTime }}</span>
        }
      </div>
      <button
        class="checkbox"
        [class.checked]="item().status === 'done'"
        role="checkbox"
        [attr.aria-checked]="item().status === 'done'"
        [attr.aria-label]="'Mark ' + item().label + (item().status === 'done' ? ' as incomplete' : ' as complete')"
        (click)="toggled.emit(item().id)"
      >
        @if (item().status === 'done') {
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <polyline points="2,5 4,7.5 8,2.5"
              stroke="currentColor" stroke-width="1.8"
              fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        }
      </button>
      <span class="label" [class.struck]="item().status === 'done'">{{ item().label }}</span>
      @if (typeBadge()) {
        <span class="type-badge type-badge--{{ item().type }}">{{ typeBadge() }}</span>
      }
      @if (item().oneShot) {
        <span
          class="one-shot-indicator"
          role="img"
          [attr.aria-label]="oneShotLabel()"
          [attr.title]="oneShotLabel()"
        >
          <svg class="one-shot-icon" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
            <line x1="6" y1="1.5" x2="6" y2="7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <polyline points="3.5,5 6,7.5 8.5,5" stroke="currentColor" stroke-width="1.4"
              fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="3" y1="10.2" x2="9" y2="10.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <span class="one-shot-label" aria-hidden="true">skip if missed</span>
        </span>
      }
    </div>
  `,
  styleUrl: './task-row.scss'
})
export class TaskRowComponent {
  readonly item    = input.required<ScheduleTask>();
  readonly toggled = output<string>();

  protected readonly typeBadge = computed(() => TYPE_BADGE_LABELS[this.item().type] ?? null);

  // Read-only indicator copy (rendered only when the task is one-shot). Setting the flag
  // moves to the future task edit view (#914), so the day-view row no longer toggles it.
  protected readonly oneShotLabel = computed(() =>
    `${this.item().label} will skip if missed — it won't carry over if not done`
  );
}
