import { Component, computed, input, output } from '@angular/core';
import { parseDateOnly, addDaysDateOnly, todayIso } from '../../../../core/utils/date-only';
import { DayZoneView } from '../../../../core/utils/zone-projection';
import { zoneCity, zoneShort, zoneLong, offsetPhrase } from '../../../../core/utils/zone-format';

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
    @if (zoneView()?.kind === 'divergent') {
      <div class="tz-banner">
        <span class="tz-chip">{{ chip() }}</span>
        <span class="tz-subtext">{{ subtext() }}</span>
        <button type="button" class="tz-why" (click)="whyClicked.emit()">(why?)</button>
      </div>
    } @else if (zoneView()?.kind === 'travel') {
      <span class="tz-pill">TRAVEL DAY</span>
    }
  `,
  styleUrl: './day-header.scss'
})
export class DayHeaderComponent {
  readonly date = input.required<string>(); // ISO YYYY-MM-DD
  readonly dateChange = output<string>();
  readonly zoneView = input<DayZoneView | null>(null);
  readonly whyClicked = output<void>();

  readonly formattedDate = computed(() => {
    return parseDateOnly(this.date()).toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
    });
  });

  readonly isToday = computed(() => this.date() === todayIso());

  private readonly viewDate = computed(() => parseDateOnly(this.date()));

  protected readonly chip = computed(() => {
    const v = this.zoneView();
    const z = v?.incomingZone;
    return z ? `${zoneCity(z)} · ${zoneShort(z, this.viewDate())}` : '';
  });

  protected readonly subtext = computed(() => {
    const v = this.zoneView();
    const z = v?.incomingZone;
    return z ? `${zoneLong(z, this.viewDate())} · ${offsetPhrase(z, v!.currentZone, this.viewDate())}` : '';
  });

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
    return addDaysDateOnly(this.date(), days);
  }
}
