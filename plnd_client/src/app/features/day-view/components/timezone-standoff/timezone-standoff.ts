import { Component, input, output } from '@angular/core';
import { zoneLong } from '../../../../core/utils/zone-format';

@Component({
  selector: 'app-timezone-standoff',
  standalone: true,
  template: `
    <div class="tz-standoff" role="status">
      <span class="tz-standoff__msg">
        Back in {{ intendedLabel() }}, or is your device clock off?
      </span>
      <div class="tz-standoff__actions">
        <button type="button" class="tz-standoff__btn" (click)="moved.emit()">I moved here</button>
        <button type="button" class="tz-standoff__btn tz-standoff__btn--ghost" (click)="clockOff.emit()">Clock's off</button>
      </div>
    </div>
  `,
  styleUrl: './timezone-standoff.scss',
})
export class TimezoneStandoffComponent {
  readonly intendedZone = input.required<string>(); // IANA
  readonly deviceZone   = input.required<string>(); // IANA
  readonly moved    = output<void>(); // user moved → create user anchor at deviceZone
  readonly clockOff = output<void>(); // device wrong → dismiss standoff
  protected intendedLabel = () => zoneLong(this.intendedZone(), new Date());
}
