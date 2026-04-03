import { Component, computed, input, output } from '@angular/core';
import { todayIso, toIsoDate } from '../../../../core/services/schedule.service';

@Component({
  selector: 'app-day-header',
  standalone: true,
  template: `
    <div class="day-header">
      <button class="nav-btn" (click)="prev()" aria-label="Previous day">‹</button>
      <div class="date-center" role="button" tabindex="0" (click)="onDateClick()" (keydown.enter)="onDateClick()" (keydown.space)="onDateClick()">
        <span class="date-text">{{ formattedDate() }}</span>
        @if (isToday()) {
          <span class="today-badge">Today</span>
        }
      </div>
      <button class="nav-btn" (click)="next()" aria-label="Next day">›</button>
    </div>
  `,
  styleUrl: './day-header.scss'
})
export class DayHeaderComponent {
  readonly date = input.required<string>(); // ISO YYYY-MM-DD
  readonly dateChange = output<string>();

  readonly formattedDate = computed(() => {
    const d = new Date(this.date() + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  });

  readonly isToday = computed(() => this.date() === todayIso());

  prev(): void {
    this.dateChange.emit(this.offset(-1));
  }

  next(): void {
    this.dateChange.emit(this.offset(1));
  }

  onDateClick(): void {
    // TODO: open date picker
  }

  private offset(days: number): string {
    const [y, m, d] = this.date().split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return toIsoDate(date);
  }
}
