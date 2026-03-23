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
  `
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
