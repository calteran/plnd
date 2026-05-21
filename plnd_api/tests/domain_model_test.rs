// Offline tests for domain model structs and constants.
// No live database required — follows the dietary_restrictions_test.rs pattern.
use plnd_api::routes::domain_constants::{
    SUGGESTED_MEAL_NAMES, SUGGESTED_OCCASION_TAGS, VALID_ENERGY_LEVELS, VALID_FOCUS_LEVELS,
    VALID_INTENSITY_LEVELS, VALID_PRIORITY_LEVELS, VALID_RECURRENCE_TYPES, VALID_TASK_STATUSES,
    VALID_TASK_TYPES,
};
use plnd_data::models::{
    CatalogDish, CatalogDishIngredient, CatalogExercise, CatalogIngredient, CatalogMeal,
    CatalogMealDish, ExerciseTask, GenericTask, Routine, ScheduleEntry, Task, UserDish,
    UserDishIngredient, UserExercise, UserMeal, UserMealDish, WorkTask,
};

// ---------------------------------------------------------------------------
// Constant assertions
// ---------------------------------------------------------------------------

#[test]
fn test_valid_task_types_has_six_values() {
    assert_eq!(VALID_TASK_TYPES.len(), 6);
    assert!(
        !VALID_TASK_TYPES.contains(&"meal"),
        "meal is no longer a task type"
    );
    assert!(VALID_TASK_TYPES.contains(&"exercise"));
    assert!(VALID_TASK_TYPES.contains(&"work"));
    assert!(VALID_TASK_TYPES.contains(&"leisure"));
    assert!(VALID_TASK_TYPES.contains(&"appointment"));
    assert!(VALID_TASK_TYPES.contains(&"medication"));
    assert!(VALID_TASK_TYPES.contains(&"general"));
}

#[test]
fn test_valid_energy_levels_has_three_values() {
    assert_eq!(VALID_ENERGY_LEVELS.len(), 3);
    assert!(VALID_ENERGY_LEVELS.contains(&"low"));
    assert!(VALID_ENERGY_LEVELS.contains(&"medium"));
    assert!(VALID_ENERGY_LEVELS.contains(&"high"));
}

#[test]
fn test_valid_task_statuses_has_five_values() {
    assert_eq!(VALID_TASK_STATUSES.len(), 5);
    assert!(VALID_TASK_STATUSES.contains(&"planned"));
    assert!(VALID_TASK_STATUSES.contains(&"in_progress"));
    assert!(VALID_TASK_STATUSES.contains(&"completed"));
    assert!(VALID_TASK_STATUSES.contains(&"skipped"));
    assert!(VALID_TASK_STATUSES.contains(&"deferred"));
}

#[test]
fn test_valid_intensity_levels_has_three_values() {
    assert_eq!(VALID_INTENSITY_LEVELS.len(), 3);
    assert!(VALID_INTENSITY_LEVELS.contains(&"low"));
    assert!(VALID_INTENSITY_LEVELS.contains(&"moderate"));
    assert!(VALID_INTENSITY_LEVELS.contains(&"high"));
}

#[test]
fn test_valid_focus_levels_has_three_values() {
    assert_eq!(VALID_FOCUS_LEVELS.len(), 3);
    assert!(VALID_FOCUS_LEVELS.contains(&"low"));
    assert!(VALID_FOCUS_LEVELS.contains(&"medium"));
    assert!(VALID_FOCUS_LEVELS.contains(&"deep"));
}

#[test]
fn test_valid_priority_levels_has_three_values() {
    assert_eq!(VALID_PRIORITY_LEVELS.len(), 3);
    assert!(VALID_PRIORITY_LEVELS.contains(&"low"));
    assert!(VALID_PRIORITY_LEVELS.contains(&"normal"));
    assert!(VALID_PRIORITY_LEVELS.contains(&"high"));
}

#[test]
fn test_valid_recurrence_types_has_five_values() {
    assert_eq!(VALID_RECURRENCE_TYPES.len(), 5);
    assert!(VALID_RECURRENCE_TYPES.contains(&"daily"));
    assert!(VALID_RECURRENCE_TYPES.contains(&"weekdays"));
    assert!(VALID_RECURRENCE_TYPES.contains(&"weekly"));
    assert!(VALID_RECURRENCE_TYPES.contains(&"monthly"));
    assert!(VALID_RECURRENCE_TYPES.contains(&"yearly"));
    assert!(!VALID_RECURRENCE_TYPES.contains(&"custom"));
}

#[test]
fn test_suggested_occasion_tags_has_twelve_values() {
    assert_eq!(SUGGESTED_OCCASION_TAGS.len(), 12);
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"breakfast-friendly"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"lunch"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"dinner"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"snack"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"quick"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"light"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"hearty"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"comfort"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"weekend"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"festive"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"post-workout"));
    assert!(SUGGESTED_OCCASION_TAGS.contains(&"meal-prep"));
}

#[test]
fn test_suggested_meal_names_has_seven_values() {
    assert_eq!(SUGGESTED_MEAL_NAMES.len(), 7);
    assert!(SUGGESTED_MEAL_NAMES.contains(&"breakfast"));
    assert!(SUGGESTED_MEAL_NAMES.contains(&"morning snack"));
    assert!(SUGGESTED_MEAL_NAMES.contains(&"lunch"));
    assert!(SUGGESTED_MEAL_NAMES.contains(&"afternoon snack"));
    assert!(SUGGESTED_MEAL_NAMES.contains(&"dinner"));
    assert!(SUGGESTED_MEAL_NAMES.contains(&"late snack"));
    assert!(SUGGESTED_MEAL_NAMES.contains(&"post-workout"));
}

// ---------------------------------------------------------------------------
// Serde round-trip tests — cover JSONB (Value), Decimal, Vec<String>, Vec<Uuid>
// ---------------------------------------------------------------------------

#[test]
fn test_catalog_ingredient_serde_round_trip() {
    let json = r#"{
        "ingredient_id": "00000000-0000-0000-0000-000000000001",
        "name": "Apple",
        "description": null,
        "serving_size_g": "182.00",
        "nutrition": {"calories_kcal": 95.0, "protein_g": 0.5, "carbohydrates_g": 25.1},
        "allergens": [],
        "occasion_tags": ["snack", "breakfast-friendly"],
        "external_id": "1750340",
        "external_source": "usda_fdc",
        "contributed_by_user_id": null,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z"
    }"#;
    let ingredient: CatalogIngredient = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(ingredient.name, "Apple");
    assert_eq!(
        ingredient.occasion_tags,
        vec!["snack", "breakfast-friendly"]
    );
    assert!(ingredient.nutrition.is_some());
    assert_eq!(ingredient.external_source.as_deref(), Some("usda_fdc"));

    let serialized = serde_json::to_string(&ingredient).expect("serialize failed");
    let reparsed: CatalogIngredient =
        serde_json::from_str(&serialized).expect("re-deserialize failed");
    assert_eq!(reparsed.name, ingredient.name);
    assert_eq!(reparsed.serving_size_g, ingredient.serving_size_g);
}

#[test]
fn test_catalog_dish_serde_with_overridden_flags() {
    let json = r#"{
        "dish_id": "00000000-0000-0000-0000-000000000002",
        "name": "Caesar Salad",
        "description": "Classic Caesar",
        "instructions": null,
        "prep_time_minutes": 15,
        "cook_time_minutes": 0,
        "servings": "2.00",
        "allergens": ["gluten", "dairy", "egg"],
        "allergens_overridden": true,
        "occasion_tags": ["lunch", "dinner"],
        "tags": ["salad", "classic"],
        "nutrition": {"calories_kcal": 340.0},
        "nutrition_overridden": false,
        "contributed_by_user_id": null,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z"
    }"#;
    let dish: CatalogDish = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(dish.name, "Caesar Salad");
    assert!(dish.allergens_overridden);
    assert!(!dish.nutrition_overridden);
    assert_eq!(dish.allergens, vec!["gluten", "dairy", "egg"]);
}

#[test]
fn test_catalog_dish_ingredient_serde_round_trip() {
    let json = r#"{
        "dish_ingredient_id": "00000000-0000-0000-0000-000000000010",
        "dish_id": "00000000-0000-0000-0000-000000000002",
        "ingredient_id": "00000000-0000-0000-0000-000000000001",
        "quantity": "1.5000",
        "unit": "cups",
        "preparation_note": "torn into pieces",
        "is_optional": false,
        "sort_order": 0
    }"#;
    let dbi: CatalogDishIngredient = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(dbi.unit, "cups");
    assert!(!dbi.is_optional);
    assert_eq!(dbi.sort_order, 0);
}

#[test]
fn test_catalog_meal_has_no_meal_type_field() {
    // meal_type was removed; occasion_tags TEXT[] is the replacement
    let json = r#"{
        "meal_id": "00000000-0000-0000-0000-000000000003",
        "name": "Weekend Brunch",
        "description": null,
        "servings": "4.00",
        "allergens": [],
        "allergens_overridden": false,
        "occasion_tags": ["breakfast-friendly", "weekend"],
        "tags": ["brunch"],
        "nutrition": null,
        "nutrition_overridden": false,
        "contributed_by_user_id": null,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z"
    }"#;
    let meal: CatalogMeal = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(meal.occasion_tags, vec!["breakfast-friendly", "weekend"]);
    assert!(meal.nutrition.is_none());
}

#[test]
fn test_catalog_meal_dish_serde_round_trip() {
    let json = r#"{
        "meal_dish_id": "00000000-0000-0000-0000-000000000020",
        "meal_id": "00000000-0000-0000-0000-000000000003",
        "dish_id": "00000000-0000-0000-0000-000000000002",
        "dish_servings": "1.00",
        "notes": null,
        "sort_order": 1
    }"#;
    let cmd: CatalogMealDish = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(cmd.sort_order, 1);
    assert!(cmd.notes.is_none());
}

#[test]
fn test_user_dish_serde_with_occasion_tags() {
    // rating/is_safe_food/is_blocked/notes moved to UserDishPref (migration 0013)
    let json = r#"{
        "user_dish_id": "00000000-0000-0000-0000-000000000004",
        "user_id": "00000000-0000-0000-0000-000000000099",
        "catalog_dish_id": null,
        "name": "My Chicken Stir Fry",
        "description": null,
        "instructions": "Stir fry on high heat",
        "prep_time_minutes": 10,
        "cook_time_minutes": 15,
        "servings": "2.00",
        "allergens": ["soy"],
        "allergens_overridden": false,
        "occasion_tags": ["dinner", "quick"],
        "tags": ["asian", "chicken"],
        "nutrition": null,
        "nutrition_overridden": false,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z"
    }"#;
    let dish: UserDish = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(dish.name, "My Chicken Stir Fry");
    assert_eq!(dish.occasion_tags, vec!["dinner", "quick"]);
    assert!(dish.catalog_dish_id.is_none());
}

#[test]
fn test_user_dish_ingredient_serde_round_trip() {
    let json = r#"{
        "user_dish_ingredient_id": "00000000-0000-0000-0000-000000000030",
        "user_dish_id": "00000000-0000-0000-0000-000000000004",
        "ingredient_id": "00000000-0000-0000-0000-000000000001",
        "quantity": "200.0000",
        "unit": "grams",
        "preparation_note": null,
        "is_optional": true,
        "sort_order": 2
    }"#;
    let udi: UserDishIngredient = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(udi.unit, "grams");
    assert!(udi.is_optional);
    assert_eq!(udi.sort_order, 2);
}

#[test]
fn test_user_meal_serde_round_trip() {
    // rating/is_safe_food/is_blocked/notes moved to UserMealPref (migration 0013)
    let json = r#"{
        "user_meal_id": "00000000-0000-0000-0000-000000000005",
        "user_id": "00000000-0000-0000-0000-000000000099",
        "catalog_meal_id": "00000000-0000-0000-0000-000000000003",
        "name": "My Brunch",
        "description": null,
        "servings": "2.00",
        "allergens": [],
        "allergens_overridden": false,
        "occasion_tags": ["breakfast-friendly"],
        "tags": [],
        "nutrition": null,
        "nutrition_overridden": false,
        "nutrition_estimated": false,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z"
    }"#;
    let meal: UserMeal = serde_json::from_str(json).expect("deserialize failed");
    assert!(meal.catalog_meal_id.is_some());
    assert_eq!(meal.occasion_tags, vec!["breakfast-friendly"]);
    assert!(!meal.nutrition_estimated);
}

#[test]
fn test_user_meal_dish_exactly_one_source() {
    // catalog_dish_id set, user_dish_id null
    let json = r#"{
        "user_meal_dish_id": "00000000-0000-0000-0000-000000000040",
        "user_meal_id": "00000000-0000-0000-0000-000000000005",
        "catalog_dish_id": "00000000-0000-0000-0000-000000000002",
        "user_dish_id": null,
        "dish_servings": "1.00",
        "notes": null,
        "sort_order": 0
    }"#;
    let umd: UserMealDish = serde_json::from_str(json).expect("deserialize failed");
    assert!(umd.catalog_dish_id.is_some());
    assert!(umd.user_dish_id.is_none());
}

#[test]
fn test_catalog_exercise_serde_with_equipment() {
    let json = r#"{
        "exercise_id": "00000000-0000-0000-0000-000000000006",
        "name": "Barbell Squat",
        "description": "Compound lower body exercise",
        "default_duration_minutes": 45,
        "intensity": "high",
        "muscle_groups": ["quadriceps", "hamstrings", "glutes"],
        "equipment_required": ["barbell", "squat rack"],
        "tags": ["strength", "compound"],
        "external_id": "123",
        "external_source": "wger",
        "contributed_by_user_id": null,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z"
    }"#;
    let ex: CatalogExercise = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(ex.intensity, "high");
    assert_eq!(ex.equipment_required, vec!["barbell", "squat rack"]);
    assert_eq!(ex.external_source.as_deref(), Some("wger"));
}

#[test]
fn test_user_exercise_serde_round_trip() {
    let json = r#"{
        "user_exercise_id": "00000000-0000-0000-0000-000000000007",
        "user_id": "00000000-0000-0000-0000-000000000099",
        "catalog_exercise_id": null,
        "name": "Home HIIT",
        "description": null,
        "default_duration_minutes": 20,
        "intensity": "moderate",
        "muscle_groups": ["core", "legs"],
        "equipment_required": [],
        "tags": ["cardio", "hiit"],
        "rating": 4,
        "is_blocked": false,
        "notes": null,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z"
    }"#;
    let ex: UserExercise = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(ex.rating, Some(4));
    assert!(ex.equipment_required.is_empty());
}

#[test]
fn test_task_serde_round_trip() {
    let json = r#"{
        "task_id": "00000000-0000-0000-0000-000000000012",
        "user_id": "00000000-0000-0000-0000-000000000099",
        "title": "Morning Run",
        "task_type": "exercise",
        "scheduled_start": "2026-03-15T07:00:00Z",
        "duration_minutes": 30,
        "energy_required": "medium",
        "status": "planned",
        "is_anchor": false,
        "one_shot": false,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z"
    }"#;
    let task: Task = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(task.task_type, "exercise");
    assert_eq!(task.status, "planned");
    assert!(!task.is_anchor);
}

#[test]
fn test_exercise_task_serde_round_trip() {
    let json = r#"{
        "task_id": "00000000-0000-0000-0000-000000000014",
        "user_exercise_id": "00000000-0000-0000-0000-000000000007",
        "intensity": "moderate",
        "muscle_groups": ["core", "legs"]
    }"#;
    let et: ExerciseTask = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(et.intensity.as_deref(), Some("moderate"));
    assert_eq!(et.muscle_groups, vec!["core", "legs"]);
}

#[test]
fn test_work_task_serde_round_trip() {
    let json = r#"{
        "task_id": "00000000-0000-0000-0000-000000000015",
        "project_label": "PLND backend",
        "focus_level_required": "deep"
    }"#;
    let wt: WorkTask = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(wt.project_label.as_deref(), Some("PLND backend"));
    assert_eq!(wt.focus_level_required.as_deref(), Some("deep"));
}

#[test]
fn test_generic_task_serde_round_trip() {
    let json = r#"{
        "task_id": "00000000-0000-0000-0000-000000000016",
        "category": "household",
        "priority": "normal"
    }"#;
    let gt: GenericTask = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(gt.priority, "normal");
    assert_eq!(gt.category.as_deref(), Some("household"));
}

#[test]
fn test_routine_serde_round_trip() {
    let json = r#"{
        "routine_id": "00000000-0000-0000-0000-000000000017",
        "user_id": "00000000-0000-0000-0000-000000000099",
        "task_type": "exercise",
        "title": "Daily Morning Run",
        "recurrence_tag": "daily",
        "recurrence_rule": "FREQ=DAILY",
        "time_window_start": "07:00:00",
        "time_window_end": "08:30:00",
        "duration_minutes": 20,
        "energy_required": "low",
        "is_anchor": true,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z"
    }"#;
    let routine: Routine = serde_json::from_str(json).expect("deserialize failed");
    assert!(routine.is_anchor);
    assert_eq!(routine.task_type, "exercise");
    assert_eq!(routine.recurrence_tag.as_deref(), Some("daily"));
}

#[test]
fn test_schedule_entry_serde_with_after_anchor() {
    let json = r#"{
        "entry_id": "00000000-0000-0000-0000-000000000018",
        "user_id": "00000000-0000-0000-0000-000000000099",
        "routine_id": null,
        "task_type": "work",
        "date": "2026-03-15",
        "scheduled_start": "2026-03-15T09:00:00Z",
        "scheduled_end": "2026-03-15T11:00:00Z",
        "status": "planned",
        "actual_start": null,
        "actual_end": null,
        "after_anchor": "breakfast",
        "slot_meal_anchor_id": null,
        "deviation_note": null,
        "one_shot": false,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z"
    }"#;
    let entry: ScheduleEntry = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(entry.after_anchor.as_deref(), Some("breakfast"));
    assert!(entry.slot_meal_anchor_id.is_none());
    assert!(entry.routine_id.is_none());
    assert!(entry.actual_start.is_none());
}
