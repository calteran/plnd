import { MealRef, MealSlot } from './week-plan';

export interface MealHabitResponse {
  habit_id: string;
  user_id: string;
  meal_slot: MealSlot;
  recurrence_rule: string;  // RRULE string, e.g. "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
  meal_ref: MealRef | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface CreateMealHabitRequest {
  meal_slot: MealSlot;
  recurrence_rule: string;
  meal_ref?: MealRef;
  title?: string;
}
