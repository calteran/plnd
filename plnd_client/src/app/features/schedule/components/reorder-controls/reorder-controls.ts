import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';

/**
 * Presentational reorder affordance. Hidden until the host row is :focus-within
 * (see reorder-controls.scss). Renders ↑/↓ always; «/» only when the day-jump
 * inputs are provided (the wizards), so the day view shows just two buttons.
 */
@Component({
  selector: 'app-reorder-controls',
  standalone: true,
  template: `
    <span class="reorder-controls">
      <button type="button" class="reorder-btn" data-testid="reorder-up"
        [disabled]="!canUp()" [attr.aria-label]="'Move ' + label() + ' earlier'"
        (click)="up.emit()">↑</button>
      <button type="button" class="reorder-btn" data-testid="reorder-down"
        [disabled]="!canDown()" [attr.aria-label]="'Move ' + label() + ' later'"
        (click)="down.emit()">↓</button>
      @if (canPrevDay() !== undefined) {
        <button type="button" class="reorder-btn" data-testid="reorder-prev-day"
          [disabled]="!canPrevDay()" [attr.aria-label]="'Move ' + label() + ' to the previous day'"
          (click)="prevDay.emit()">«</button>
      }
      @if (canNextDay() !== undefined) {
        <button type="button" class="reorder-btn" data-testid="reorder-next-day"
          [disabled]="!canNextDay()" [attr.aria-label]="'Move ' + label() + ' to the next day'"
          (click)="nextDay.emit()">»</button>
      }
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './reorder-controls.scss',
})
export class ReorderControlsComponent {
  readonly label      = input.required<string>();
  readonly canUp      = input(false);
  readonly canDown    = input(false);
  readonly canPrevDay = input<boolean | undefined>(undefined);
  readonly canNextDay = input<boolean | undefined>(undefined);

  readonly up      = output<void>();
  readonly down    = output<void>();
  readonly prevDay = output<void>();
  readonly nextDay = output<void>();
}
