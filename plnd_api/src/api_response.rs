use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use plnd_data::models::{
    CatalogDish, CatalogDishIngredient, CatalogIngredient, CatalogMeal, CatalogMealDish,
    DietaryRestriction, MealSuggestion, ScheduleEntry, ScheduleTemplate, Task, User,
    UserDishPrefDetail, UserIngredientPref, UserMealPrefDetail, UserPreferences,
};
use plnd_data::query_types::{
    PlanStatusResponse, PostSchedulePlanResponse, SchedulePeriodResponse,
};
use rust_decimal::Decimal;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

/// API response wrapper for `plnd_data::models::User`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UserResponse {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub is_active: bool,
    pub last_login: Option<DateTime<Utc>>,
    pub avatar_url: Option<String>,
    pub onboarding_completed: bool,
}

impl From<User> for UserResponse {
    fn from(u: User) -> Self {
        Self {
            user_id: u.user_id,
            email: u.email,
            display_name: u.display_name,
            created_at: u.created_at,
            updated_at: u.updated_at,
            is_active: u.is_active,
            last_login: u.last_login,
            avatar_url: u.avatar_url,
            onboarding_completed: u.onboarding_completed,
        }
    }
}

/// API response wrapper for `plnd_data::models::UserPreferences`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UserPreferencesResponse {
    pub user_id: Uuid,
    pub week_start_day: i16,
    pub planning_trigger_offset: i16,
    pub default_plan_length_days: i16,
    pub wake_time: NaiveTime,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<UserPreferences> for UserPreferencesResponse {
    fn from(p: UserPreferences) -> Self {
        Self {
            user_id: p.user_id,
            week_start_day: p.week_start_day,
            planning_trigger_offset: p.planning_trigger_offset,
            default_plan_length_days: p.default_plan_length_days,
            wake_time: p.wake_time,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}

// ---------------------------------------------------------------------------
// Meal suggestion response types
// ---------------------------------------------------------------------------

/// API response item for `GET /my/meal-suggestions`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct MealSuggestionResponse {
    pub id: Uuid,
    pub name: String,
    /// "meal" or "dish"
    pub suggestion_type: String,
}

impl From<MealSuggestion> for MealSuggestionResponse {
    fn from(s: MealSuggestion) -> Self {
        Self {
            id: s.id,
            name: s.name,
            suggestion_type: s.suggestion_type,
        }
    }
}

/// API response wrapper for `plnd_data::models::DietaryRestriction`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DietaryRestrictionResponse {
    pub restriction_id: Uuid,
    pub user_id: Uuid,
    pub restriction_type: String,
    pub name: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<DietaryRestriction> for DietaryRestrictionResponse {
    fn from(r: DietaryRestriction) -> Self {
        Self {
            restriction_id: r.restriction_id,
            user_id: r.user_id,
            restriction_type: r.restriction_type,
            name: r.name,
            notes: r.notes,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

// ---------------------------------------------------------------------------
// Catalog response types
// ---------------------------------------------------------------------------

/// API response wrapper for `plnd_data::models::CatalogIngredient`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CatalogIngredientResponse {
    pub ingredient_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    #[schema(value_type = Option<f64>)]
    pub serving_size_g: Option<Decimal>,
    #[schema(value_type = Option<Object>)]
    pub nutrition: Option<Value>,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub external_id: Option<String>,
    pub external_source: Option<String>,
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<CatalogIngredient> for CatalogIngredientResponse {
    fn from(i: CatalogIngredient) -> Self {
        Self {
            ingredient_id: i.ingredient_id,
            name: i.name,
            description: i.description,
            serving_size_g: i.serving_size_g,
            nutrition: i.nutrition,
            allergens: i.allergens,
            occasion_tags: i.occasion_tags,
            external_id: i.external_id,
            external_source: i.external_source,
            contributed_by_user_id: i.contributed_by_user_id,
            created_at: i.created_at,
            updated_at: i.updated_at,
        }
    }
}

/// API response wrapper for `plnd_data::models::CatalogDishIngredient`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CatalogDishIngredientResponse {
    pub dish_ingredient_id: Uuid,
    pub dish_id: Uuid,
    pub ingredient_id: Uuid,
    #[schema(value_type = f64)]
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
    pub sort_order: i16,
}

impl From<CatalogDishIngredient> for CatalogDishIngredientResponse {
    fn from(i: CatalogDishIngredient) -> Self {
        Self {
            dish_ingredient_id: i.dish_ingredient_id,
            dish_id: i.dish_id,
            ingredient_id: i.ingredient_id,
            quantity: i.quantity,
            unit: i.unit,
            preparation_note: i.preparation_note,
            is_optional: i.is_optional,
            sort_order: i.sort_order,
        }
    }
}

/// API response wrapper for `plnd_data::models::CatalogMealDish`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CatalogMealDishResponse {
    pub meal_dish_id: Uuid,
    pub meal_id: Uuid,
    pub dish_id: Uuid,
    #[schema(value_type = f64)]
    pub dish_servings: Decimal,
    pub notes: Option<String>,
    pub sort_order: i16,
}

impl From<CatalogMealDish> for CatalogMealDishResponse {
    fn from(d: CatalogMealDish) -> Self {
        Self {
            meal_dish_id: d.meal_dish_id,
            meal_id: d.meal_id,
            dish_id: d.dish_id,
            dish_servings: d.dish_servings,
            notes: d.notes,
            sort_order: d.sort_order,
        }
    }
}

/// API response for a catalog dish with its ingredients.
/// Replaces the local `DishDetailResponse` that used `#[serde(flatten)]` (incompatible with utoipa).
/// JSON shape is identical.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DishDetailApiResponse {
    pub dish_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
    pub prep_time_minutes: Option<i32>,
    pub cook_time_minutes: Option<i32>,
    #[schema(value_type = f64)]
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub allergens_overridden: bool,
    pub occasion_tags: Vec<String>,
    pub tags: Vec<String>,
    #[schema(value_type = Option<Object>)]
    pub nutrition: Option<Value>,
    pub nutrition_overridden: bool,
    pub external_id: Option<String>,
    pub external_source: Option<String>,
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub ingredients: Vec<CatalogDishIngredientResponse>,
}

impl From<(CatalogDish, Vec<CatalogDishIngredient>)> for DishDetailApiResponse {
    fn from((dish, ingredients): (CatalogDish, Vec<CatalogDishIngredient>)) -> Self {
        Self {
            dish_id: dish.dish_id,
            name: dish.name,
            description: dish.description,
            instructions: dish.instructions,
            prep_time_minutes: dish.prep_time_minutes,
            cook_time_minutes: dish.cook_time_minutes,
            servings: dish.servings,
            allergens: dish.allergens,
            allergens_overridden: dish.allergens_overridden,
            occasion_tags: dish.occasion_tags,
            tags: dish.tags,
            nutrition: dish.nutrition,
            nutrition_overridden: dish.nutrition_overridden,
            external_id: dish.external_id,
            external_source: dish.external_source,
            contributed_by_user_id: dish.contributed_by_user_id,
            created_at: dish.created_at,
            updated_at: dish.updated_at,
            ingredients: ingredients
                .into_iter()
                .map(CatalogDishIngredientResponse::from)
                .collect(),
        }
    }
}

/// API response for a catalog meal with its dishes.
/// Replaces the local `MealDetailResponse` that used `#[serde(flatten)]` (incompatible with utoipa).
/// JSON shape is identical.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct MealDetailApiResponse {
    pub meal_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    #[schema(value_type = f64)]
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub allergens_overridden: bool,
    pub occasion_tags: Vec<String>,
    pub tags: Vec<String>,
    #[schema(value_type = Option<Object>)]
    pub nutrition: Option<Value>,
    pub nutrition_overridden: bool,
    pub external_id: Option<String>,
    pub external_source: Option<String>,
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub dishes: Vec<CatalogMealDishResponse>,
}

impl From<(CatalogMeal, Vec<CatalogMealDish>)> for MealDetailApiResponse {
    fn from((meal, dishes): (CatalogMeal, Vec<CatalogMealDish>)) -> Self {
        Self {
            meal_id: meal.meal_id,
            name: meal.name,
            description: meal.description,
            servings: meal.servings,
            allergens: meal.allergens,
            allergens_overridden: meal.allergens_overridden,
            occasion_tags: meal.occasion_tags,
            tags: meal.tags,
            nutrition: meal.nutrition,
            nutrition_overridden: meal.nutrition_overridden,
            external_id: meal.external_id,
            external_source: meal.external_source,
            contributed_by_user_id: meal.contributed_by_user_id,
            created_at: meal.created_at,
            updated_at: meal.updated_at,
            dishes: dishes
                .into_iter()
                .map(CatalogMealDishResponse::from)
                .collect(),
        }
    }
}

// ---------------------------------------------------------------------------
// Task response types
// ---------------------------------------------------------------------------

/// API response wrapper for `plnd_data::models::Task`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct TaskResponse {
    pub task_id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub task_type: String,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub duration_minutes: Option<i32>,
    pub energy_required: String,
    pub status: String,
    pub is_milepost: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Task> for TaskResponse {
    fn from(t: Task) -> Self {
        Self {
            task_id: t.task_id,
            user_id: t.user_id,
            title: t.title,
            task_type: t.task_type,
            scheduled_start: t.scheduled_start,
            duration_minutes: t.duration_minutes,
            energy_required: t.energy_required,
            status: t.status,
            is_milepost: t.is_milepost,
            created_at: t.created_at,
            updated_at: t.updated_at,
        }
    }
}

// ---------------------------------------------------------------------------
// Schedule response types
// ---------------------------------------------------------------------------

/// API response wrapper for `plnd_data::models::ScheduleEntry`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ScheduleEntryResponse {
    pub entry_id: Uuid,
    pub user_id: Uuid,
    pub template_id: Option<Uuid>,
    pub task_type: String,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub title: Option<String>,
    pub date: NaiveDate,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub scheduled_end: Option<DateTime<Utc>>,
    pub status: String,
    pub actual_start: Option<DateTime<Utc>>,
    pub actual_end: Option<DateTime<Utc>>,
    pub family_meal_id: Option<Uuid>,
    pub after_milepost: Option<String>,
    pub after_entry_id: Option<Uuid>,
    pub deviation_note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<ScheduleEntry> for ScheduleEntryResponse {
    fn from(e: ScheduleEntry) -> Self {
        Self {
            entry_id: e.entry_id,
            user_id: e.user_id,
            template_id: e.template_id,
            task_type: e.task_type,
            task_ref_id: e.task_ref_id,
            task_ref_type: e.task_ref_type,
            title: e.title,
            date: e.date,
            scheduled_start: e.scheduled_start,
            scheduled_end: e.scheduled_end,
            status: e.status,
            actual_start: e.actual_start,
            actual_end: e.actual_end,
            family_meal_id: e.family_meal_id,
            after_milepost: e.after_milepost,
            after_entry_id: e.after_entry_id,
            deviation_note: e.deviation_note,
            created_at: e.created_at,
            updated_at: e.updated_at,
        }
    }
}

/// API response wrapper for `plnd_data::query_types::SchedulePeriodResponse`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SchedulePeriodApiResponse {
    pub entries: Vec<ScheduleEntryResponse>,
    pub carryover: Vec<ScheduleEntryResponse>,
}

impl From<SchedulePeriodResponse> for SchedulePeriodApiResponse {
    fn from(r: SchedulePeriodResponse) -> Self {
        Self {
            entries: r
                .entries
                .into_iter()
                .map(ScheduleEntryResponse::from)
                .collect(),
            carryover: r
                .carryover
                .into_iter()
                .map(ScheduleEntryResponse::from)
                .collect(),
        }
    }
}

/// API response wrapper for `plnd_data::query_types::PlanStatusResponse`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct PlanStatusApiResponse {
    pub planned: bool,
    pub entry_count: i64,
}

impl From<PlanStatusResponse> for PlanStatusApiResponse {
    fn from(r: PlanStatusResponse) -> Self {
        Self {
            planned: r.planned,
            entry_count: r.entry_count,
        }
    }
}

/// API response wrapper for `plnd_data::query_types::PostSchedulePlanResponse`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct PostSchedulePlanApiResponse {
    pub committed: i64,
    pub planning_task_status: String,
}

impl From<PostSchedulePlanResponse> for PostSchedulePlanApiResponse {
    fn from(r: PostSchedulePlanResponse) -> Self {
        Self {
            committed: r.committed,
            planning_task_status: r.planning_task_status,
        }
    }
}

/// API response wrapper for `plnd_data::models::ScheduleTemplate`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ScheduleTemplateResponse {
    pub template_id: Uuid,
    pub user_id: Uuid,
    pub task_type: String,
    pub title: String,
    pub recurrence: String,
    pub recurrence_rule: Option<String>,
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    pub duration_minutes: Option<i32>,
    pub energy_required: String,
    pub is_milepost: bool,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<ScheduleTemplate> for ScheduleTemplateResponse {
    fn from(t: ScheduleTemplate) -> Self {
        Self {
            template_id: t.template_id,
            user_id: t.user_id,
            task_type: t.task_type,
            title: t.title,
            recurrence: t.recurrence,
            recurrence_rule: t.recurrence_rule,
            time_window_start: t.time_window_start,
            time_window_end: t.time_window_end,
            duration_minutes: t.duration_minutes,
            energy_required: t.energy_required,
            is_milepost: t.is_milepost,
            task_ref_id: t.task_ref_id,
            task_ref_type: t.task_ref_type,
            created_at: t.created_at,
            updated_at: t.updated_at,
        }
    }
}

// ---------------------------------------------------------------------------
// User library preference response types
// ---------------------------------------------------------------------------

/// API response wrapper for `plnd_data::models::UserDishPrefDetail`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UserDishPrefDetailResponse {
    pub user_dish_pref_id: Uuid,
    pub user_id: Uuid,
    pub catalog_dish_id: Option<Uuid>,
    pub user_dish_id: Option<Uuid>,
    pub rating: Option<i16>,
    pub is_safe_food: bool,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub name: String,
    pub source: String,
    pub has_personal_recipe: bool,
    pub origin_external_source: Option<String>,
}

impl From<UserDishPrefDetail> for UserDishPrefDetailResponse {
    fn from(d: UserDishPrefDetail) -> Self {
        Self {
            user_dish_pref_id: d.user_dish_pref_id,
            user_id: d.user_id,
            catalog_dish_id: d.catalog_dish_id,
            user_dish_id: d.user_dish_id,
            rating: d.rating,
            is_safe_food: d.is_safe_food,
            is_blocked: d.is_blocked,
            notes: d.notes,
            created_at: d.created_at,
            updated_at: d.updated_at,
            name: d.name,
            source: d.source,
            has_personal_recipe: d.has_personal_recipe,
            origin_external_source: d.origin_external_source,
        }
    }
}

/// API response wrapper for `plnd_data::models::UserIngredientPref`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UserIngredientPrefResponse {
    pub user_ingredient_pref_id: Uuid,
    pub user_id: Uuid,
    pub catalog_ingredient_id: Uuid,
    /// −2=refuse, −1=tolerate, 0=neutral, +1=enjoy, +2=strongly prefer
    pub preference_score: i16,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<UserIngredientPref> for UserIngredientPrefResponse {
    fn from(p: UserIngredientPref) -> Self {
        Self {
            user_ingredient_pref_id: p.user_ingredient_pref_id,
            user_id: p.user_id,
            catalog_ingredient_id: p.catalog_ingredient_id,
            preference_score: p.preference_score,
            notes: p.notes,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}

/// API response wrapper for `plnd_data::models::UserMealPrefDetail`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UserMealPrefDetailResponse {
    pub user_meal_pref_id: Uuid,
    pub user_id: Uuid,
    pub catalog_meal_id: Option<Uuid>,
    pub user_meal_id: Option<Uuid>,
    pub rating: Option<i16>,
    pub is_safe_food: bool,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub name: String,
    pub source: String,
    pub has_personal_recipe: bool,
    pub origin_external_source: Option<String>,
    pub nutrition_estimated: bool,
}

impl From<UserMealPrefDetail> for UserMealPrefDetailResponse {
    fn from(m: UserMealPrefDetail) -> Self {
        Self {
            user_meal_pref_id: m.user_meal_pref_id,
            user_id: m.user_id,
            catalog_meal_id: m.catalog_meal_id,
            user_meal_id: m.user_meal_id,
            rating: m.rating,
            is_safe_food: m.is_safe_food,
            is_blocked: m.is_blocked,
            notes: m.notes,
            created_at: m.created_at,
            updated_at: m.updated_at,
            name: m.name,
            source: m.source,
            has_personal_recipe: m.has_personal_recipe,
            origin_external_source: m.origin_external_source,
            nutrition_estimated: m.nutrition_estimated,
        }
    }
}
