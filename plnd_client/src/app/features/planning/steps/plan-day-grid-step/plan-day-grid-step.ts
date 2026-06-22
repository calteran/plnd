import { Component, OnInit, computed, inject, input, ChangeDetectionStrategy } from '@angular/core';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { DayTypesMealsService } from '../../../../core/services/day-types-meals.service';
import { PlanDayCardComponent } from './plan-day-card';
import { daysInRange } from '../../utils/date-format.utils';

@Component({
  selector: 'app-plan-day-grid-step',
  standalone: true,
  imports: [PlanDayCardComponent],
  template: `
    <div class="plan-day-grid">
      @if (firstRun()) {
        <div class="first-run-callout">
          <strong>Welcome!</strong> Here's your week at a glance. Tap any day to expand and review tasks and meals.
        </div>
      }
      <h2>Day Review</h2>
      <p class="subtitle">Review each day. Tap a card to expand and edit.</p>
      <div class="day-grid">
        @for (day of horizonDays(); track day) {
          <app-plan-day-card [date]="day" [horizonDays]="horizonDays()" />
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .day-grid { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; }
    @media (max-width: 600px) {
      .day-grid { flex-direction: column; overflow-x: auto; flex-wrap: nowrap; }
    }
  `]
})
export class PlanDayGridStepComponent implements OnInit {
  private readonly weekPlanService = inject(WeekPlanService);
  private readonly dayTypesMealsService = inject(DayTypesMealsService);

  // Onboarding-flow overrides — defaults leave weekly wizard behaviour unchanged
  ngOnInit(): void {
    this.dayTypesMealsService.load();
  }

  readonly firstRun  = input(false);
  readonly planStart = input<string | undefined>(undefined);
  readonly planEnd   = input<string | undefined>(undefined);

  readonly horizonDays = computed(() => {
    const start = this.planStart();
    const end   = this.planEnd();
    return (start && end)
      ? daysInRange(start, end)
      : this.weekPlanService.horizonDays();
  });
}
