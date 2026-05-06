import { Component, computed, input, output } from '@angular/core';
import { ItemType, ScheduleTask } from '../../../../core/models/schedule';

const TYPE_BADGE_LABELS: Partial<Record<ItemType, string>> = {
  work:        'Work',
  exercise:    'Exercise',
  leisure:     'Leisure',
  medication:  'Rx',
  appointment: 'Appt',
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
    </div>
  `,
  styleUrl: './task-row.scss'
})
export class TaskRowComponent {
  readonly item    = input.required<ScheduleTask>();
  readonly toggled = output<string>();

  protected readonly typeBadge = computed(() => TYPE_BADGE_LABELS[this.item().type] ?? null);
}
