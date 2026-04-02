use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserPreferences {
    pub user_id: Uuid,
    pub week_start_day: i16,
    pub planning_trigger_offset: i16,
    pub default_plan_length_days: i16,
    pub wake_time: NaiveTime,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DietaryRestriction {
    pub restriction_id: Uuid,
    pub user_id: Uuid,
    pub restriction_type: String,
    pub name: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
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

// ---------------------------------------------------------------------------
// Catalog: Ingredients (layer 1 — atomic food items)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogIngredient {
    pub ingredient_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub serving_size_g: Option<Decimal>,
    pub nutrition: Option<Value>, // per serving; canonical shape: { calories_kcal, protein_g, fat_g, ... }
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub external_id: Option<String>,
    pub external_source: Option<String>, // 'usda_fdc' | 'openfoodfacts' | null
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Catalog: Dishes (layer 2 — recipes composed of ingredients)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogDish {
    pub dish_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
    pub prep_time_minutes: Option<i32>,
    pub cook_time_minutes: Option<i32>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub allergens_overridden: bool, // true = manually verified, not computed from ingredients
    pub occasion_tags: Vec<String>, // suggestions only — no DB CHECK
    pub tags: Vec<String>,
    pub nutrition: Option<Value>, // per serving; null = compute from ingredients
    pub nutrition_overridden: bool,
    pub external_id: Option<String>,
    pub external_source: Option<String>, // 'themealdb' | null
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogDishIngredient {
    pub dish_ingredient_id: Uuid,
    pub dish_id: Uuid,
    pub ingredient_id: Uuid,
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
    pub sort_order: i16,
}

// ---------------------------------------------------------------------------
// Catalog: Meals (layer 3 — eating occasion templates composed of dishes)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogMeal {
    pub meal_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub allergens_overridden: bool,
    pub occasion_tags: Vec<String>, // replaces meal_type enum; suggestions only
    pub tags: Vec<String>,
    pub nutrition: Option<Value>, // per person; null = compute from dishes
    pub nutrition_overridden: bool,
    pub external_id: Option<String>,
    pub external_source: Option<String>, // reserved for future meal-level providers
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogMealDish {
    pub meal_dish_id: Uuid,
    pub meal_id: Uuid,
    pub dish_id: Uuid,
    pub dish_servings: Decimal,
    pub notes: Option<String>,
    pub sort_order: i16,
}

// ---------------------------------------------------------------------------
// User: Personal dish library
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserDish {
    pub user_dish_id: Uuid,
    pub user_id: Uuid,
    pub catalog_dish_id: Option<Uuid>, // fork origin; no ongoing constraint after fork
    pub name: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
    pub prep_time_minutes: Option<i32>,
    pub cook_time_minutes: Option<i32>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub allergens_overridden: bool,
    pub occasion_tags: Vec<String>,
    pub tags: Vec<String>,
    pub nutrition: Option<Value>,
    pub nutrition_overridden: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserDishIngredient {
    pub user_dish_ingredient_id: Uuid,
    pub user_dish_id: Uuid,
    pub ingredient_id: Uuid, // refs catalog_ingredients only (personal overrides deferred to Phase 3/4)
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
    pub sort_order: i16,
}

// ---------------------------------------------------------------------------
// User: Personal meal library
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserMeal {
    pub user_meal_id: Uuid,
    pub user_id: Uuid,
    pub catalog_meal_id: Option<Uuid>, // fork origin; no ongoing constraint after fork
    pub name: String,
    pub description: Option<String>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub allergens_overridden: bool,
    pub occasion_tags: Vec<String>,
    pub tags: Vec<String>,
    pub nutrition: Option<Value>,
    pub nutrition_overridden: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserMealDish {
    pub user_meal_dish_id: Uuid,
    pub user_meal_id: Uuid,
    pub catalog_dish_id: Option<Uuid>, // exactly one of catalog_dish_id / user_dish_id must be set (DB CHECK)
    pub user_dish_id: Option<Uuid>,
    pub dish_servings: Decimal,
    pub notes: Option<String>,
    pub sort_order: i16,
}

// ---------------------------------------------------------------------------
// User: Dish and Meal preference records (aggregate roots)
// ---------------------------------------------------------------------------

/// Stable handle for a user's relationship with a dish.
/// The client always uses user_dish_pref_id — it never changes even after a fork.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserDishPref {
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
}

/// UserDishPref enriched with display fields computed by the list/detail query.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserDishPrefDetail {
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
    // Computed fields from JOIN
    pub name: String,
    pub source: String, // "catalog" | "personal"
    pub has_personal_recipe: bool,
    pub origin_external_source: Option<String>,
}

/// Stable handle for a user's relationship with a meal.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserMealPref {
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
}

/// UserMealPref enriched with display fields computed by the list/detail query.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserMealPrefDetail {
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
    // Computed fields from JOIN
    pub name: String,
    pub source: String, // "catalog" | "personal"
    pub has_personal_recipe: bool,
    pub origin_external_source: Option<String>,
}

/// User preference for a catalog ingredient (blocked/notes only — no fork concept for ingredients).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserIngredientPref {
    pub user_ingredient_pref_id: Uuid,
    pub user_id: Uuid,
    pub catalog_ingredient_id: Uuid,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Catalog: Exercises
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CatalogExercise {
    pub exercise_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub default_duration_minutes: Option<i32>,
    pub intensity: String, // 'low' | 'moderate' | 'high'
    pub muscle_groups: Vec<String>,
    pub equipment_required: Vec<String>,
    pub tags: Vec<String>,
    pub external_id: Option<String>,
    pub external_source: Option<String>, // 'wger' | null
    pub contributed_by_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// User: Personal exercise library
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserExercise {
    pub user_exercise_id: Uuid,
    pub user_id: Uuid,
    pub catalog_exercise_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub default_duration_minutes: Option<i32>,
    pub intensity: String,
    pub muscle_groups: Vec<String>,
    pub equipment_required: Vec<String>,
    pub tags: Vec<String>,
    pub rating: Option<i16>,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Family coordination
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Family {
    pub family_id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FamilyMember {
    pub family_member_id: Uuid,
    pub family_id: Uuid,
    pub user_id: Uuid,
    pub role: String,            // 'owner' | 'member' | 'caregiver'
    pub can_plan_for: Vec<Uuid>, // user IDs this member can schedule on behalf of
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FamilyMeal {
    pub family_meal_id: Uuid,
    pub family_id: Uuid,
    pub planned_by_user_id: Uuid,
    pub date: NaiveDate,
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    pub user_meal_id: Option<Uuid>,
    pub title: String,
    pub notes: Option<String>,
    pub participants: Vec<Uuid>, // user IDs attending
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Tasks (universal scheduling unit — base entity)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Task {
    pub task_id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub task_type: String, // 'meal' | 'exercise' | 'work' | 'leisure' | 'appointment' | 'medication' | 'custom'
    pub scheduled_start: Option<DateTime<Utc>>,
    pub duration_minutes: Option<i32>,
    pub energy_required: String, // 'low' | 'medium' | 'high'
    pub status: String,          // 'planned' | 'in_progress' | 'completed' | 'skipped' | 'deferred'
    pub is_milepost: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Task specialization tables (joined on demand by task_type)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MealTask {
    pub task_id: Uuid,
    pub user_meal_id: Option<Uuid>,
    pub user_dish_id: Option<Uuid>, // schedule a single dish without a meal wrapper
    pub family_meal_id: Option<Uuid>,
    pub occasion_label: Option<String>, // free-form: "breakfast", "morning snack", etc.
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ExerciseTask {
    pub task_id: Uuid,
    pub user_exercise_id: Option<Uuid>,
    pub intensity: Option<String>,
    pub muscle_groups: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkTask {
    pub task_id: Uuid,
    pub project_label: Option<String>,
    pub focus_level_required: Option<String>, // 'low' | 'medium' | 'deep'
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GenericTask {
    pub task_id: Uuid,
    pub category: Option<String>,
    pub priority: String, // 'low' | 'normal' | 'high'
}

// ---------------------------------------------------------------------------
// Schedule templates (recurring patterns)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ScheduleTemplate {
    pub template_id: Uuid,
    pub user_id: Uuid,
    pub task_type: String,
    pub title: String,
    pub recurrence: String, // 'daily' | 'weekdays' | 'weekly' | 'custom'
    pub recurrence_rule: Option<String>, // RRULE string for custom recurrence
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    pub duration_minutes: Option<i32>,
    pub energy_required: String,
    pub is_milepost: bool,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>, // 'user_meal' | 'user_dish' | 'user_exercise' | ...
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Schedule entries (concrete instances on a specific date)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ScheduleEntry {
    pub entry_id: Uuid,
    pub user_id: Uuid,
    pub template_id: Option<Uuid>, // null for ad-hoc entries
    pub task_type: String,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub title: Option<String>,
    pub date: NaiveDate,
    pub scheduled_start: DateTime<Utc>,
    pub scheduled_end: Option<DateTime<Utc>>,
    pub status: String,
    pub actual_start: Option<DateTime<Utc>>,
    pub actual_end: Option<DateTime<Utc>>,
    pub family_meal_id: Option<Uuid>,
    pub after_milepost: Option<String>, // 'breakfast' | 'lunch' | 'dinner' — temporal ordering anchor
    pub after_entry_id: Option<Uuid>,   // explicit sequencing link
    pub deviation_note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Weekly planning — response types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulePeriodResponse {
    pub entries: Vec<ScheduleEntry>,
    pub carryover: Vec<ScheduleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStatusResponse {
    pub planned: bool,
    pub entry_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PostSchedulePlanResponse {
    pub committed: i64,
    pub planning_task_status: String,
}

// ---------------------------------------------------------------------------
// Schedule commit input (DB-layer types, decoupled from HTTP request types)
// ---------------------------------------------------------------------------

/// DB-layer carryover decision — used by `schedule::commit_plan`.
/// The matching HTTP type (with utoipa) lives in `plnd_api/src/models.rs` and maps to this type at the route boundary.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CarryoverDecision {
    Accept,
    Defer,
    Dismiss,
}

/// Input to `schedule::commit_plan` — constructed from the HTTP request in plnd_api.
#[derive(Debug, Clone)]
pub struct CommitPlanInput {
    pub plan_start: NaiveDate,
    pub plan_end: NaiveDate,
    pub planning_task_id: Uuid,
    pub entries: Vec<PlanEntryInput>,
    /// Pre-resolved from the HTTP request's `Option<bool>` with a default of `false`.
    pub replace: bool,
    pub carryover_decisions: HashMap<Uuid, CarryoverDecision>,
}

/// One schedule entry to be committed, decoded from HTTP in plnd_api.
#[derive(Debug, Clone)]
pub struct PlanEntryInput {
    pub date: NaiveDate,
    pub task_type: String,
    pub task_ref_id: Option<Uuid>,
    pub task_ref_type: Option<String>,
    pub title: Option<String>,
    pub scheduled_start: NaiveTime,
    pub after_milepost: Option<String>,
}
