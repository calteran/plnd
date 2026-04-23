// plnd_client/src/app/core/models/meal-habit.ts
// Aligned with backend MealHabitResponse (plnd_api/src/api_response.rs).
// Slot is 'breakfast' | 'lunch' | 'dinner' (snack excluded per API constraint).

export type MealHabitSlot = 'breakfast' | 'lunch' | 'dinner';

export interface MealHabitResponse {
  id: string;
  user_id: string;
  meal_name: string;
  slot: MealHabitSlot;
  recurrence_rule: string;
  created_at: string;
}

export interface CreateMealHabitRequest {
  meal_name: string;
  slot: MealHabitSlot;
  recurrence_rule: string;
}
