export interface UserIngredientPref {
  user_ingredient_pref_id: string;
  user_id: string;
  catalog_ingredient_id: string;
  is_blocked: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IngredientPrefRequest {
  is_blocked: boolean;
  notes?: string | null;
}
