export type MealRefType = 'user_meal' | 'catalog_meal' | 'user_dish' | 'catalog_dish';

export interface PlannedMealEntryDto {
  meal_entry_id: string;
  meal_anchor_instance_id: string;
  meal_ref_id: string;
  meal_ref_type: MealRefType;
  title: string | null;
  /** Date of the anchor instance; populated on list queries, null on commit RETURNING. */
  anchor_date: string | null;
  /** Name of the anchor instance (e.g. "Breakfast"); same null rule as anchor_date. */
  anchor_name: string | null;
}

export interface MealEntryRequest {
  date: string;       // YYYY-MM-DD
  meal_name: string;  // e.g. "breakfast"
  meal_ref_id: string;
  meal_ref_type: MealRefType;
  title?: string;
}
