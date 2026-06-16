use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use plnd_data::models::{
    CatalogDish, CatalogDishIngredient, CatalogIngredient, CatalogMeal, CatalogMealDish, DayType,
    DietaryRestriction, MealPatternEntry, MealSuggestion, PlannedMealEntry, Routine, ScheduleEntry,
    Task, TimezoneAnchor, User, UserDishPrefDetail, UserIngredientPref, UserMealPrefDetail,
    UserPreferences,
};
use plnd_data::query_types::{
    PlanStatusResponse, PostSchedulePlanResponse, SchedulePeriodResponse, TimezoneAnchorWithSource,
};
use rust_decimal::Decimal;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;
use veil::Redact;

/// API response wrapper for `plnd_data::models::User`.
#[derive(Redact, Serialize, utoipa::ToSchema)]
#[redact(all)]
pub struct UserResponse {
    #[redact(skip)]
    pub user_id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    #[redact(skip)]
    pub created_at: DateTime<Utc>,
    #[redact(skip)]
    pub updated_at: DateTime<Utc>,
    #[redact(skip)]
    pub is_active: bool,
    #[redact(skip)]
    pub last_login: Option<DateTime<Utc>>,
    pub avatar_url: Option<String>,
    #[redact(skip)]
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
    pub planning_time: Option<NaiveTime>,
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
            planning_time: p.planning_time,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}

/// API response wrapper for `plnd_data::models::MealAnchorInstance` (issue #828).
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct MealAnchorInstanceResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub date: NaiveDate,
    pub name: String,
    pub preferred_time: NaiveTime,
    pub tolerance_minutes: i32,
    pub sort_order: i32,
    pub template_entry_id: Option<Uuid>,
    /// Consumption lifecycle: "planned" | "consumed" | "skipped".
    pub status: String,
    /// Set exactly when `status == "consumed"`.
    pub consumed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<plnd_data::models::MealAnchorInstance> for MealAnchorInstanceResponse {
    fn from(i: plnd_data::models::MealAnchorInstance) -> Self {
        Self {
            id: i.id,
            user_id: i.user_id,
            date: i.date,
            name: i.name,
            preferred_time: i.preferred_time,
            tolerance_minutes: i.tolerance_minutes,
            sort_order: i.sort_order,
            template_entry_id: i.template_entry_id,
            status: i.status,
            consumed_at: i.consumed_at,
            created_at: i.created_at,
            updated_at: i.updated_at,
        }
    }
}

/// API response wrapper for `plnd_data::models::MealPatternEntry`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct MealPatternEntryResponse {
    pub id: Uuid,
    pub day_type_id: Uuid,
    pub name: String,
    pub preferred_time: NaiveTime,
    pub tolerance_minutes: i32,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
}

impl From<MealPatternEntry> for MealPatternEntryResponse {
    fn from(e: MealPatternEntry) -> Self {
        Self {
            id: e.id,
            day_type_id: e.day_type_id,
            name: e.name,
            preferred_time: e.preferred_time,
            tolerance_minutes: e.tolerance_minutes,
            sort_order: e.sort_order,
            created_at: e.created_at,
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
    /// Wall-clock `HH:MM` (planned time-of-day); storage migration tracked in #936.
    pub scheduled_start: Option<String>,
    pub duration_minutes: Option<i32>,
    pub energy_required: String,
    pub status: String,
    pub is_anchor: bool,
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
            scheduled_start: t.scheduled_start.map(|dt| dt.format("%H:%M").to_string()),
            duration_minutes: t.duration_minutes,
            energy_required: t.energy_required,
            status: t.status,
            is_anchor: t.is_anchor,
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
    pub routine_id: Option<Uuid>,
    pub task_type: String,
    pub title: Option<String>,
    pub date: NaiveDate,
    /// Wall-clock `HH:MM` (planned time-of-day); storage migration tracked in #936.
    pub scheduled_start: Option<String>,
    pub scheduled_end: Option<String>,
    pub status: String,
    pub actual_start: Option<DateTime<Utc>>,
    pub actual_end: Option<DateTime<Utc>>,
    pub after_anchor: Option<String>,
    pub slot_meal_anchor_id: Option<Uuid>,
    pub deviation_note: Option<String>,
    pub duration_minutes: Option<i32>,
    pub energy_required: Option<String>,
    pub one_shot: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<ScheduleEntry> for ScheduleEntryResponse {
    fn from(e: ScheduleEntry) -> Self {
        Self {
            entry_id: e.entry_id,
            user_id: e.user_id,
            routine_id: e.routine_id,
            task_type: e.task_type,
            title: e.title,
            date: e.date,
            scheduled_start: e.scheduled_start.map(|dt| dt.format("%H:%M").to_string()),
            scheduled_end: e.scheduled_end.map(|dt| dt.format("%H:%M").to_string()),
            status: e.status,
            actual_start: e.actual_start,
            actual_end: e.actual_end,
            after_anchor: e.after_anchor,
            slot_meal_anchor_id: e.slot_meal_anchor_id,
            deviation_note: e.deviation_note,
            duration_minutes: e.duration_minutes,
            energy_required: e.energy_required,
            one_shot: e.one_shot,
            created_at: e.created_at,
            updated_at: e.updated_at,
        }
    }
}

/// API response wrapper for the carryover endpoint — all incomplete tasks before `before`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CarryoverApiResponse {
    pub carryover: Vec<ScheduleEntryResponse>,
}

impl From<Vec<ScheduleEntry>> for CarryoverApiResponse {
    fn from(entries: Vec<ScheduleEntry>) -> Self {
        Self {
            carryover: entries
                .into_iter()
                .map(ScheduleEntryResponse::from)
                .collect(),
        }
    }
}

/// API response wrapper for `plnd_data::models::PlannedMealEntry`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct PlannedMealEntryResponse {
    pub meal_entry_id: Uuid,
    pub meal_anchor_instance_id: Uuid,
    pub meal_ref_id: Uuid,
    pub meal_ref_type: String,
    pub title: Option<String>,
    /// Date of the associated meal anchor instance. Populated when returned via
    /// `/schedule/period` (list queries); null when returned from commit_plan RETURNING.
    pub anchor_date: Option<chrono::NaiveDate>,
    /// Name of the associated meal anchor instance (e.g. "Breakfast"). Same null rule.
    pub anchor_name: Option<String>,
}

impl From<PlannedMealEntry> for PlannedMealEntryResponse {
    fn from(e: PlannedMealEntry) -> Self {
        Self {
            meal_entry_id: e.meal_entry_id,
            meal_anchor_instance_id: e.meal_anchor_instance_id,
            meal_ref_id: e.meal_ref_id,
            meal_ref_type: e.meal_ref_type,
            title: e.title,
            anchor_date: e.anchor_date,
            anchor_name: e.anchor_name,
        }
    }
}

/// API response wrapper for `plnd_data::query_types::SchedulePeriodResponse`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SchedulePeriodApiResponse {
    pub entries: Vec<ScheduleEntryResponse>,
    pub carryover: Vec<ScheduleEntryResponse>,
    pub planned_meals: Vec<PlannedMealEntryResponse>,
}

impl SchedulePeriodApiResponse {
    /// Assemble a `SchedulePeriodApiResponse` from the schedule period query
    /// result plus the planned-meal rows fetched separately via
    /// `MealPlanRepository::list_for_period`.
    pub fn from_parts(r: SchedulePeriodResponse, planned_meals: Vec<PlannedMealEntry>) -> Self {
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
            planned_meals: planned_meals
                .into_iter()
                .map(PlannedMealEntryResponse::from)
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

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CommittedEntryRef {
    pub entry_id: Uuid,
    pub title: Option<String>,
    pub date: NaiveDate,
    pub after_anchor: Option<String>,
}

/// API response wrapper for `plnd_data::query_types::PostSchedulePlanResponse`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct PostSchedulePlanApiResponse {
    pub committed: i64,
    pub planning_task_status: String,
    pub entries: Vec<CommittedEntryRef>,
}

impl From<PostSchedulePlanResponse> for PostSchedulePlanApiResponse {
    fn from(r: PostSchedulePlanResponse) -> Self {
        Self {
            committed: r.committed,
            planning_task_status: r.planning_task_status,
            entries: r
                .entries
                .into_iter()
                .map(|e| CommittedEntryRef {
                    entry_id: e.entry_id,
                    title: e.title,
                    date: e.date,
                    after_anchor: e.after_anchor,
                })
                .collect(),
        }
    }
}

/// API response wrapper for `plnd_data::models::DayType`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DayTypeResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    /// Bitmask: bit 0 = Sunday, bit 1 = Monday, …, bit 6 = Saturday. 0 for cycle types.
    pub days_bitmask: i32,
    pub wake_time: NaiveTime,
    pub sleep_time: NaiveTime,
    pub is_cycle: bool,
    pub cycle_length: Option<i32>,
    pub anchor_date: Option<NaiveDate>,
    /// For cycle types: low `cycle_length` bits indicate which positions in the
    /// cycle this day type covers (bit 0 = anchor_date). 0 for weekday types.
    pub cycle_bitmask: i32,
    pub created_at: DateTime<Utc>,
}

impl From<DayType> for DayTypeResponse {
    fn from(d: DayType) -> Self {
        Self {
            id: d.id,
            user_id: d.user_id,
            name: d.name,
            days_bitmask: d.days_bitmask,
            wake_time: d.wake_time,
            sleep_time: d.sleep_time,
            is_cycle: d.is_cycle,
            cycle_length: d.cycle_length,
            anchor_date: d.anchor_date,
            cycle_bitmask: d.cycle_bitmask,
            created_at: d.created_at,
        }
    }
}

/// API response wrapper for `plnd_data::models::Routine`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct RoutineResponse {
    pub routine_id: Uuid,
    pub user_id: Uuid,
    pub task_type: String,
    pub title: String,
    pub recurrence_tag: Option<String>,
    pub recurrence_rule: String,
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    pub duration_minutes: Option<i32>,
    pub energy_required: String,
    pub is_anchor: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Routine> for RoutineResponse {
    fn from(t: Routine) -> Self {
        Self {
            routine_id: t.routine_id,
            user_id: t.user_id,
            task_type: t.task_type,
            title: t.title,
            recurrence_tag: t.recurrence_tag,
            recurrence_rule: t.recurrence_rule,
            time_window_start: t.time_window_start,
            time_window_end: t.time_window_end,
            duration_minutes: t.duration_minutes,
            energy_required: t.energy_required,
            is_anchor: t.is_anchor,
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

// ---------------------------------------------------------------------------
// Timezone anchor response types
// ---------------------------------------------------------------------------

/// API response wrapper for `plnd_data::models::TimezoneAnchor`.
///
/// `zone` is the IANA timezone name string (e.g. `"America/New_York"`);
/// `chrono_tz::Tz` is not directly schema-representable so it is serialized
/// as its canonical name. `source` is likewise serialized as a string
/// (`"device"` | `"user"` | `"inferred"`).
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct TimezoneAnchorResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub effective_date: NaiveDate,
    pub effective_time: Option<NaiveTime>,
    /// IANA timezone name (e.g. `"America/New_York"`).
    pub zone: String,
    /// `"device"` | `"user"` | `"inferred"`.
    pub source: String,
    pub source_ref: Option<Uuid>,
    /// Human title of the originating task (resolved from `source_ref`), or
    /// `null` when there is no source or the referenced task no longer exists.
    /// Drives the inferred-anchor provenance line in the `(why?)` popover.
    pub source_title: Option<String>,
    pub inference_group: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<TimezoneAnchor> for TimezoneAnchorResponse {
    fn from(a: TimezoneAnchor) -> Self {
        // No JOIN context here, so the source title is unresolved. Callers that
        // need it (the anchors-list endpoint) use `From<TimezoneAnchorWithSource>`.
        Self {
            id: a.id,
            user_id: a.user_id,
            effective_date: a.effective_date,
            effective_time: a.effective_time,
            zone: a.zone.name().to_string(),
            source: a.source.as_str().to_string(),
            source_ref: a.source_ref,
            source_title: None,
            inference_group: a.inference_group,
            created_at: a.created_at,
            updated_at: a.updated_at,
        }
    }
}

impl From<TimezoneAnchorWithSource> for TimezoneAnchorResponse {
    fn from(a: TimezoneAnchorWithSource) -> Self {
        let TimezoneAnchorWithSource {
            anchor,
            source_title,
        } = a;
        Self {
            source_title,
            ..Self::from(anchor)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_anchor() -> TimezoneAnchor {
        TimezoneAnchor {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            effective_date: NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
            effective_time: None,
            zone: chrono_tz::America::Denver,
            source: plnd_data::models::TimezoneSource::Inferred,
            source_ref: Some(Uuid::nil()),
            inference_group: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn timezone_anchor_response_carries_source_title() {
        let with = TimezoneAnchorWithSource {
            anchor: sample_anchor(),
            source_title: Some("Flight to DEN".to_string()),
        };
        let resp = TimezoneAnchorResponse::from(with);
        assert_eq!(resp.source_title, Some("Flight to DEN".to_string()));
    }

    #[test]
    fn timezone_anchor_response_from_bare_anchor_has_null_source_title() {
        let resp = TimezoneAnchorResponse::from(sample_anchor());
        assert_eq!(resp.source_title, None);
    }

    #[test]
    fn schedule_entry_response_includes_one_shot() {
        let entry = ScheduleEntry {
            entry_id: Uuid::nil(),
            user_id: Uuid::nil(),
            routine_id: None,
            task_type: "general".into(),
            title: Some("take evening meds".into()),
            date: NaiveDate::from_ymd_opt(2026, 6, 12).unwrap(),
            scheduled_start: None,
            scheduled_end: None,
            status: "planned".into(),
            actual_start: None,
            actual_end: None,
            after_anchor: None,
            slot_meal_anchor_id: None,
            deviation_note: None,
            duration_minutes: None,
            energy_required: None,
            one_shot: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let resp = ScheduleEntryResponse::from(entry);
        assert!(resp.one_shot);
    }

    #[test]
    fn schedule_entry_response_emits_wall_clock_hhmm() {
        use chrono::{TimeZone, Utc};
        let entry = ScheduleEntry {
            entry_id: Uuid::nil(),
            user_id: Uuid::nil(),
            routine_id: None,
            task_type: "general".into(),
            title: None,
            date: NaiveDate::from_ymd_opt(2026, 6, 15).unwrap(),
            scheduled_start: Some(Utc.with_ymd_and_hms(2026, 6, 15, 9, 0, 0).unwrap()),
            scheduled_end: None,
            status: "planned".into(),
            actual_start: None,
            actual_end: None,
            after_anchor: None,
            slot_meal_anchor_id: None,
            deviation_note: None,
            duration_minutes: None,
            energy_required: None,
            one_shot: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let resp = ScheduleEntryResponse::from(entry);
        assert_eq!(resp.scheduled_start.as_deref(), Some("09:00"));
    }

    #[test]
    fn user_response_debug_redacts_pii() {
        let resp = UserResponse {
            user_id: Uuid::nil(),
            email: "secret@example.com".to_string(),
            display_name: Some("Jane Doe".to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            is_active: true,
            last_login: None,
            avatar_url: Some("https://example.com/photo.jpg".to_string()),
            onboarding_completed: false,
        };
        let debug = format!("{:?}", resp);

        assert!(
            !debug.contains("secret@example.com"),
            "email leaked: {debug}"
        );
        assert!(!debug.contains("Jane Doe"), "display_name leaked: {debug}");
        assert!(!debug.contains("photo.jpg"), "avatar_url leaked: {debug}");

        assert!(
            debug.contains("00000000-0000-0000-0000-000000000000"),
            "user_id missing: {debug}"
        );
    }
}
