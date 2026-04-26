import { Component, EventEmitter, Output, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

type DotState = 'completed' | 'current' | 'ahead';

@Component({
  selector: 'app-spoke-chrome',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="spoke-chrome">
      <header class="spoke-header">
        <a routerLink="/onboarding" class="hub-link">← Back</a>
        <h2 class="spoke-title">{{ title() }}</h2>
        <div
          class="dot-row"
          role="progressbar"
          [attr.aria-label]="'Step ' + currentStep() + ' of ' + totalSteps()"
          [attr.aria-valuemin]="1"
          [attr.aria-valuenow]="currentStep()"
          [attr.aria-valuemax]="totalSteps()"
        >
          @for (dot of dots(); track $index) {
            <span
              class="dot"
              [class.dot--completed]="dot.state === 'completed'"
              [class.dot--current]="dot.state === 'current'"
              [title]="'Step ' + ($index + 1)"
            ></span>
          }
        </div>
      </header>

      <div class="spoke-content">
        <ng-content />
      </div>

      <footer class="spoke-footer">
        @if (currentStep() > 1) {
          <button type="button" class="btn-back" (click)="backClick.emit()">← Back</button>
        } @else {
          <span class="footer-spacer"></span>
        }
        @if (showContinue()) {
          <button
            type="button"
            class="btn-continue"
            [disabled]="continueDisabled()"
            [style.opacity]="continueDisabled() ? '0.4' : '1'"
            [style.cursor]="continueDisabled() ? 'not-allowed' : 'pointer'"
            (click)="!continueDisabled() && continueClick.emit()"
          >
            Save &amp; Continue →
          </button>
        } @else {
          <span class="footer-spacer"></span>
        }
      </footer>
    </div>
  `,
  styles: [`
    .spoke-chrome {
      max-width: 560px;
      margin-inline: auto;
      width: 100%;
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }

    .spoke-header {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      background: var(--color-surface-white, #ffffff);
      border-bottom: 1.5px solid var(--color-accent-border, #fde68a);
      gap: 12px;
    }

    .hub-link {
      color: var(--color-accent, #d97706);
      font-size: 13px;
      text-decoration: none;
      flex-shrink: 0;
      white-space: nowrap;
    }

    .hub-link:hover { text-decoration: underline; }

    .spoke-title {
      flex: 1;
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      color: var(--color-accent-dark, #78350f);
      margin: 0;
    }

    .dot-row {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-shrink: 0;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #d1d5db;
      border: 2px solid transparent;
      box-sizing: border-box;
      transition: background 0.15s, border-color 0.15s;
    }

    .dot--completed {
      background: var(--color-accent, #d97706);
      border-color: var(--color-accent, #d97706);
    }

    .dot--current {
      background: transparent;
      border-color: var(--color-accent, #d97706);
    }

    .spoke-content {
      flex: 1;
      padding: 20px 16px;
      overflow-y: auto;
    }

    .spoke-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-top: 1.5px solid var(--color-accent-border, #fde68a);
      background: var(--color-surface-white, #ffffff);
    }

    .footer-spacer { display: block; }

    .btn-back {
      background: transparent;
      border: 1.5px solid var(--color-accent, #d97706);
      color: var(--color-accent, #d97706);
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    }

    .btn-back:hover { background: var(--color-accent-light, #fef3c7); }

    .btn-continue {
      background: var(--color-accent, #d97706);
      color: #ffffff;
      border: none;
      padding: 8px 20px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .btn-continue:hover { background: var(--color-accent-dark, #78350f); }
  `],
})
export class SpokeChromeComponent {
  readonly title = input('');
  readonly totalSteps = input(1);
  readonly currentStep = input(1);
  readonly continueDisabled = input(false);
  readonly showContinue = input(true);
  @Output() backClick = new EventEmitter<void>();
  @Output() continueClick = new EventEmitter<void>();

  readonly dots = computed(() =>
    Array.from({ length: this.totalSteps() }, (_, i) => ({
      state: (i + 1 < this.currentStep()
        ? 'completed'
        : i + 1 === this.currentStep()
        ? 'current'
        : 'ahead') as DotState,
    }))
  );
}
