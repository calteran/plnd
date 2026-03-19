import { Component, computed, input, output } from '@angular/core';

@Component({
  selector: 'app-day-header',
  standalone: true,
  template: `
    <div class="day-header">
      <button class="nav-btn" (click)="prev()" aria-label="Previous day">‹</button>
      <div class="date-center" role="button" tabindex="0" (click)="onDateClick()" (keydown.enter)="onDateClick()">
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

  readonly isToday = computed(() =>
    this.date() === new Date().toISOString().split('T')[0]
  );

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
    const [yearStr, monthStr, dayStr] = this.date().split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    let day = parseInt(dayStr, 10) + days;
    let y = year;
    let m = month;

    // Adjust month/year if needed
    while (day > 28) {
      const daysInMonth = new Date(y, m, 0).getDate();
      if (day <= daysInMonth) break;
      day -= daysInMonth;
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    while (day < 1) {
      m--;
      if (m < 1) {
        m = 12;
        y--;
      }
      day += new Date(y, m, 0).getDate();
    }

    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
}
