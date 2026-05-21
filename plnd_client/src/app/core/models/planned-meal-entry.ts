export type MealRefType = 'user_meal' | 'catalog_meal' | 'user_dish' | 'catalog_dish';

export interface PlannedMealEntryDto {
  meal_entry_id: string;
  meal_anchor_instance_id: string;
  meal_ref_id: string;
  meal_ref_type: MealRefType;
  title: string | null;
}

export interface MealEntryRequest {
  date: string;       // YYYY-MM-DD
  meal_name: string;  // e.g. "breakfast"
  meal_ref_id: string;
  meal_ref_type: MealRefType;
  title?: string;
}
