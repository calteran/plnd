import { Component, computed, input, output, ChangeDetectionStrategy } from '@angular/core';
import { DaySwitch } from '../../../../core/utils/zone-projection';
import { zoneLong, offsetWords } from '../../../../core/utils/zone-format';
import { parseDateOnly } from '../../../../core/utils/date-only';

@Component({
  selector: 'app-timezone-switch-row',
  standalone: true,
  template: `
    <div class="tz-switch-row">
      <span class="tz-switch-row__icon" aria-hidden="true">✈</span>
      <span class="tz-switch-row__label">Switch to {{ toLabel() }} ({{ words() }})</span>
      <button type="button" class="tz-switch-row__why" (click)="whyClicked.emit()">(why?)</button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './timezone-switch-row.scss',
})
export class TimezoneSwitchRowComponent {
  readonly switch = input.required<DaySwitch>();
  readonly date   = input.required<string>();   // YYYY-MM-DD of the travel day
  readonly whyClicked = output<void>();

  private readonly viewDate = computed(() => parseDateOnly(this.date()));
  protected readonly toLabel = computed(() => zoneLong(this.switch().toZone, this.viewDate()));
  protected readonly words   = computed(() => offsetWords(this.switch().fromZone, this.switch().toZone, this.viewDate()));
}
