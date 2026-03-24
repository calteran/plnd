import { Component, computed, inject } from '@angular/core';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { PlanDayCardComponent } from './plan-day-card';

@Component({
  selector: 'app-plan-day-grid-step',
  standalone: true,
  imports: [PlanDayCardComponent],
  template: `
    <div class="plan-day-grid">
      <h2>Day Review</h2>
      <p class="subtitle">Review each day. Tap a card to expand and edit.</p>
      <div class="day-grid">
        @for (day of horizonDays(); track day) {
          <app-plan-day-card [date]="day" />
        }
      </div>
    </div>
  `,
  styles: [`
    .day-grid { display: flex; flex-wrap: wrap; gap: 1rem; }
    @media (max-width: 600px) {
      .day-grid { flex-direction: column; overflow-x: auto; flex-wrap: nowrap; }
    }
  `]
})
export class PlanDayGridStepComponent {
  private readonly weekPlanService = inject(WeekPlanService);
  readonly horizonDays = computed(() => this.weekPlanService.horizonDays());
}
