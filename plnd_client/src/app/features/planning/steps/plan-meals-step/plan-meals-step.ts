import { Component, computed, inject } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { MealSlot, PlannedMeal, getMockSuggestion } from '../../../../core/models/week-plan';

const STANDARD_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

@Component({
  selector: 'app-plan-meals-step',
  standalone: true,
  imports: [TitleCasePipe],
  template: `
    <div class="plan-meals">
      <h2>Meals</h2>
      <p class="subtitle">Suggestions are placeholders — accept, swap, or skip each slot.</p>

      @for (day of horizonDays(); track day) {
        <div class="day-meals">
          <h3>{{ day }}</h3>
          @for (slot of slots; track slot) {
            <div class="meal-slot">
              <span class="slot-label">{{ slot | titlecase }}</span>
              @if (getMeal(day, slot); as meal) {
                <span class="meal-suggestion accepted">{{ meal.title }}</span>
                <button type="button" (click)="clearSlot(day, slot)">&#x2715; Skip</button>
              } @else {
                <span class="meal-suggestion">{{ suggestion(day, slot) }}</span>
                <button type="button" data-action="accept"
                        (click)="accept(day, slot)">Accept</button>
                <button type="button" (click)="clearSlot(day, slot)">Skip</button>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .day-meals { margin-bottom: 1.25rem; }
    .meal-slot { display: flex; align-items: center; gap: 0.75rem; padding: 6px 0;
                 border-bottom: 1px solid var(--color-border-row); }
    .slot-label { width: 6rem; font-size: 12px; font-weight: 600; color: var(--color-text-muted); }
    .meal-suggestion { flex: 1; font-size: 13px; color: var(--color-text-body); }
    .meal-suggestion.accepted { color: var(--color-accent-dark); font-weight: 500; }
    .meal-slot button[data-action="accept"] { background: var(--color-accent-light);
                                              border: 1.5px solid var(--color-accent-border);
                                              border-radius: 6px; padding: 4px 12px; font-size: 12px;
                                              font-weight: 600; color: var(--color-accent-dark); cursor: pointer; }
    .meal-slot button:not([data-action]) { background: none; border: 1px solid var(--color-border-row);
                                           border-radius: 6px; padding: 4px 10px; font-size: 12px;
                                           color: var(--color-text-muted); cursor: pointer; }
  `]
})
export class PlanMealsStepComponent {
  private readonly weekPlanService = inject(WeekPlanService);
  readonly slots = STANDARD_SLOTS;
  readonly horizonDays = computed(() => this.weekPlanService.horizonDays());

  suggestion(date: string, slot: MealSlot): string {
    return getMockSuggestion(date, slot);
  }

  getMeal(date: string, slot: MealSlot): PlannedMeal | undefined {
    return this.weekPlanService.scheduledMeals()[date]?.[slot];
  }

  accept(date: string, slot: MealSlot): void {
    this.weekPlanService.setMeal(date, slot, {
      type: 'mock',
      title: getMockSuggestion(date, slot),
    });
  }

  clearSlot(date: string, slot: MealSlot): void {
    this.weekPlanService.clearMeal(date, slot);
  }
}
