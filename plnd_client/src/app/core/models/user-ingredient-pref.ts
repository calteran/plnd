export interface UserIngredientPref {
  user_ingredient_pref_id: string;
  user_id: string;
  catalog_ingredient_id: string;
  /** −2=refuse, −1=tolerate, 0=neutral, +1=enjoy, +2=strongly prefer */
  preference_score: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IngredientPrefRequest {
  /** −2=refuse, −1=tolerate, 0=neutral, +1=enjoy, +2=strongly prefer */
  preference_score: number;
  notes?: string | null;
}
