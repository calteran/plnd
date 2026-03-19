export type DishSource = 'catalog' | 'personal';

export interface DishOrigin {
  catalog_dish_id: string | null;
  external_source: string | null;
}

export interface UserDishPref {
  user_dish_pref_id: string;
  user_id: string;
  catalog_dish_id: string | null;
  user_dish_id: string | null;
  name: string;
  source: DishSource;
  has_personal_recipe: boolean;
  rating: number | null;
  is_safe_food: boolean;
  is_blocked: boolean;
  notes: string | null;
  origin_external_source: string | null;
  created_at: string;
  updated_at: string;
}

export interface DishIngredient {
  catalog_ingredient_id: string;
  quantity: number;
  unit: string;
  preparation_note?: string | null;
  is_optional?: boolean;
  sort_order?: number;
}

export interface UserDishPrefDetail extends UserDishPref {
  instructions: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  ingredients: DishIngredient[];
}

export interface CreateDishFromCatalogRequest {
  catalog_dish_id: string;
}

export interface CreateDishFromScratchRequest {
  name: string;
  instructions?: string | null;
  prep_time_minutes?: number | null;
  cook_time_minutes?: number | null;
  ingredients?: DishIngredient[];
}

export type CreateDishRequest =
  | CreateDishFromCatalogRequest
  | CreateDishFromScratchRequest;

export interface UpdateDishMetaRequest {
  rating?: number | null;
  is_safe_food?: boolean;
  is_blocked?: boolean;
  notes?: string | null;
}

export interface UpdateDishRecipeRequest {
  name?: string;
  instructions?: string | null;
  prep_time_minutes?: number | null;
  cook_time_minutes?: number | null;
}

export interface DishIngredientRequest {
  catalog_ingredient_id: string;
  quantity: number;
  unit: string;
  preparation_note?: string | null;
  is_optional?: boolean;
  sort_order?: number;
}
