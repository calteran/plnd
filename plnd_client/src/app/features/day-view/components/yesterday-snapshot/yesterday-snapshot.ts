import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { BriefingService } from '../../../../core/services/briefing.service';

@Component({
  selector: 'app-yesterday-snapshot',
  standalone: true,
  template: `
    @if (briefing.yesterday(); as y) {
      <div class="yesterday-snapshot">
        Yesterday: {{ y.tasks_done }} of {{ y.tasks_total }} tasks done
        · {{ y.meals_logged }} of {{ y.meals_planned }} meals logged
      </div>
    } @else if (briefing.yesterdayError()) {
      <div class="yesterday-snapshot yesterday-snapshot--unavailable">
        {{ briefing.yesterdayError() }}
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './yesterday-snapshot.scss',
})
export class YesterdaySnapshotComponent {
  protected readonly briefing = inject(BriefingService);
}
