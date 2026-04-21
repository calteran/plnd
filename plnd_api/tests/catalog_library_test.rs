// Offline serde round-trip tests for catalog library preference structs.
// No live database required.
use chrono::Utc;
use serde_json::{from_value, to_value};
use uuid::Uuid;

use plnd_data::models::{
    UserDishPref, UserDishPrefDetail, UserIngredientPref, UserMealPref, UserMealPrefDetail,
};

// --- UserDishPref serde round-trip ---

#[test]
fn user_dish_pref_full_round_trip() {
    // Build a UserDishPref with all fields set, serialize to JSON, deserialize back, verify
    let pref = UserDishPref {
        user_dish_pref_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        catalog_dish_id: Some(Uuid::new_v4()),
        user_dish_id: None,
        rating: Some(4),
        is_safe_food: true,
        is_blocked: false,
        notes: Some("Great dish".to_string()),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    let v = to_value(&pref).expect("serialize");
    let back: UserDishPref = from_value(v).expect("deserialize");
    assert_eq!(back.rating, Some(4));
    assert!(back.is_safe_food);
    assert!(!back.is_blocked);
    assert_eq!(back.notes.as_deref(), Some("Great dish"));
    assert!(back.catalog_dish_id.is_some());
    assert!(back.user_dish_id.is_none());
}

#[test]
fn user_dish_pref_minimal_round_trip() {
    // All optional fields None
    let pref = UserDishPref {
        user_dish_pref_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        catalog_dish_id: Some(Uuid::new_v4()),
        user_dish_id: None,
        rating: None,
        is_safe_food: false,
        is_blocked: false,
        notes: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    let v = to_value(&pref).expect("serialize");
    let back: UserDishPref = from_value(v).expect("deserialize");
    assert!(back.rating.is_none());
    assert!(back.notes.is_none());
}

// --- UserDishPrefDetail serde round-trip ---

#[test]
fn user_dish_pref_detail_catalog_source() {
    // source = "catalog", has_personal_recipe = false
    let detail = UserDishPrefDetail {
        user_dish_pref_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        catalog_dish_id: Some(Uuid::new_v4()),
        user_dish_id: None,
        rating: Some(5),
        is_safe_food: false,
        is_blocked: false,
        notes: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        name: "Chicken Stir Fry".to_string(),
        source: "catalog".to_string(),
        has_personal_recipe: false,
        origin_external_source: Some("themealdb".to_string()),
    };
    let v = to_value(&detail).expect("serialize");
    assert_eq!(v["source"], "catalog");
    assert_eq!(v["has_personal_recipe"], false);
    assert_eq!(v["name"], "Chicken Stir Fry");
    let back: UserDishPrefDetail = from_value(v).expect("deserialize");
    assert_eq!(back.source, "catalog");
    assert!(!back.has_personal_recipe);
}

#[test]
fn user_dish_pref_detail_personal_source() {
    // source = "personal", has_personal_recipe = true (forked)
    let detail = UserDishPrefDetail {
        user_dish_pref_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        catalog_dish_id: Some(Uuid::new_v4()),
        user_dish_id: Some(Uuid::new_v4()),
        rating: None,
        is_safe_food: true,
        is_blocked: false,
        notes: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        name: "My Modified Stir Fry".to_string(),
        source: "personal".to_string(),
        has_personal_recipe: true,
        origin_external_source: None,
    };
    let v = to_value(&detail).expect("serialize");
    assert_eq!(v["source"], "personal");
    assert_eq!(v["has_personal_recipe"], true);
    assert!(detail.user_dish_id.is_some());
}

// --- UserMealPref serde round-trip ---

#[test]
fn user_meal_pref_round_trip() {
    let pref = UserMealPref {
        user_meal_pref_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        catalog_meal_id: Some(Uuid::new_v4()),
        user_meal_id: None,
        rating: Some(3),
        is_safe_food: false,
        is_blocked: true,
        notes: Some("Blocked because allergen".to_string()),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    let v = to_value(&pref).expect("serialize");
    let back: UserMealPref = from_value(v).expect("deserialize");
    assert_eq!(back.rating, Some(3));
    assert!(back.is_blocked);
}

// --- UserMealPrefDetail serde round-trip ---

#[test]
fn user_meal_pref_detail_round_trip() {
    let detail = UserMealPrefDetail {
        user_meal_pref_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        catalog_meal_id: Some(Uuid::new_v4()),
        user_meal_id: None,
        rating: None,
        is_safe_food: false,
        is_blocked: false,
        notes: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        name: "Sunday Roast".to_string(),
        source: "catalog".to_string(),
        has_personal_recipe: false,
        origin_external_source: None,
        nutrition_estimated: false,
    };
    let v = to_value(&detail).expect("serialize");
    assert_eq!(v["name"], "Sunday Roast");
    assert_eq!(v["source"], "catalog");
    assert_eq!(v["has_personal_recipe"], false);
    assert_eq!(v["nutrition_estimated"], false);
}

// --- UserIngredientPref serde round-trip ---

#[test]
fn user_ingredient_pref_round_trip() {
    let pref = UserIngredientPref {
        user_ingredient_pref_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        catalog_ingredient_id: Uuid::new_v4(),
        is_blocked: true,
        notes: Some("Allergic".to_string()),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    let v = to_value(&pref).expect("serialize");
    let back: UserIngredientPref = from_value(v).expect("deserialize");
    assert!(back.is_blocked);
    assert_eq!(back.notes.as_deref(), Some("Allergic"));
    // catalog_ingredient_id must not be Option — verify it's a plain Uuid
    assert_ne!(back.catalog_ingredient_id, Uuid::nil());
}

#[test]
fn user_ingredient_pref_not_blocked_round_trip() {
    let pref = UserIngredientPref {
        user_ingredient_pref_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        catalog_ingredient_id: Uuid::new_v4(),
        is_blocked: false,
        notes: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    let v = to_value(&pref).expect("serialize");
    let back: UserIngredientPref = from_value(v).expect("deserialize");
    assert!(!back.is_blocked);
    assert!(back.notes.is_none());
}

// --- JSON shape validation ---

#[test]
fn user_dish_pref_detail_json_has_expected_top_level_keys() {
    // Verify the JSON shape matches what clients expect
    let detail = UserDishPrefDetail {
        user_dish_pref_id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        catalog_dish_id: None,
        user_dish_id: Some(Uuid::new_v4()),
        rating: None,
        is_safe_food: false,
        is_blocked: false,
        notes: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        name: "My Dish".to_string(),
        source: "personal".to_string(),
        has_personal_recipe: true,
        origin_external_source: None,
    };
    let v = to_value(&detail).expect("serialize");
    let obj = v.as_object().expect("should be object");
    // These fields must be present in the response
    assert!(obj.contains_key("user_dish_pref_id"));
    assert!(obj.contains_key("name"));
    assert!(obj.contains_key("source"));
    assert!(obj.contains_key("has_personal_recipe"));
    assert!(obj.contains_key("rating"));
    assert!(obj.contains_key("is_safe_food"));
    assert!(obj.contains_key("is_blocked"));
    assert!(obj.contains_key("notes"));
}
