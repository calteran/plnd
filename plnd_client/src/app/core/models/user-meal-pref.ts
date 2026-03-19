export type MealSource = 'catalog' | 'personal';

export interface MealDishRef {
  catalog_dish_id?: string | null;
  user_dish_pref_id?: string | null;
  dish_servings: number;
  notes?: string | null;
  sort_order?: number;
}

export interface UserMealPref {
  user_meal_pref_id: string;
  user_id: string;
  catalog_meal_id: string | null;
  user_meal_id: string | null;
  name: string;
  source: MealSource;
  has_personal_recipe: boolean;
  rating: number | null;
  is_safe_food: boolean;
  is_blocked: boolean;
  notes: string | null;
  origin_external_source: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserMealPrefDetail extends UserMealPref {
  description: string | null;
  dishes: MealDishRef[];
}

export interface CreateMealFromCatalogRequest {
  catalog_meal_id: string;
}

export interface CreateMealFromScratchRequest {
  name: string;
  description?: string | null;
  dishes?: MealDishRef[];
}

export type CreateMealRequest =
  | CreateMealFromCatalogRequest
  | CreateMealFromScratchRequest;

export interface UpdateMealMetaRequest {
  rating?: number | null;
  is_safe_food?: boolean;
  is_blocked?: boolean;
  notes?: string | null;
}

export interface UpdateMealRecipeRequest {
  name?: string;
  description?: string | null;
}

export interface MealDishRequest {
  catalog_dish_id?: string | null;
  user_dish_pref_id?: string | null;
  dish_servings: number;
  notes?: string | null;
  sort_order?: number;
}
