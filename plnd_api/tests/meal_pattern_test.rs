use plnd_api::models::{CreateMealPatternEntryRequest, UpdateMealPatternEntryRequest};
use plnd_api::routes::meal_pattern::MAX_NAME_LEN;

// --- CreateMealPatternEntryRequest ---

#[test]
fn create_request_deserializes_without_day_type_id() {
    let json = r#"{"name":"Breakfast","preferred_time":"08:00","sort_order":1}"#;
    let req: CreateMealPatternEntryRequest =
        serde_json::from_str(json).expect("should deserialize without day_type_id");
    assert_eq!(req.name, "Breakfast");
    assert!(req.preferred_time.to_string().starts_with("08:00"));
    assert_eq!(req.sort_order, 1);
    assert!(req.tolerance_minutes.is_none());
}

#[test]
fn create_request_accepts_hms_time_format() {
    let json = r#"{"name":"Lunch","preferred_time":"12:30:00","sort_order":2}"#;
    let req: CreateMealPatternEntryRequest =
        serde_json::from_str(json).expect("HH:MM:SS format should be accepted");
    assert!(req.preferred_time.to_string().starts_with("12:30"));
}

#[test]
fn create_request_with_optional_tolerance() {
    let json = r#"{"name":"Dinner","preferred_time":"18:00","tolerance_minutes":30,"sort_order":3}"#;
    let req: CreateMealPatternEntryRequest =
        serde_json::from_str(json).expect("tolerance_minutes is optional");
    assert_eq!(req.tolerance_minutes, Some(30));
}

#[test]
fn create_request_missing_name_fails() {
    let json = r#"{"preferred_time":"08:00","sort_order":1}"#;
    assert!(serde_json::from_str::<CreateMealPatternEntryRequest>(json).is_err());
}

#[test]
fn create_request_missing_preferred_time_fails() {
    let json = r#"{"name":"Breakfast","sort_order":1}"#;
    assert!(serde_json::from_str::<CreateMealPatternEntryRequest>(json).is_err());
}

#[test]
fn create_request_missing_sort_order_fails() {
    let json = r#"{"name":"Breakfast","preferred_time":"08:00"}"#;
    assert!(serde_json::from_str::<CreateMealPatternEntryRequest>(json).is_err());
}

#[test]
fn create_request_invalid_time_format_fails() {
    let json = r#"{"name":"Breakfast","preferred_time":"8am","sort_order":1}"#;
    assert!(serde_json::from_str::<CreateMealPatternEntryRequest>(json).is_err());
}

// --- UpdateMealPatternEntryRequest ---

#[test]
fn update_request_empty_body_ok() {
    let json = "{}";
    let req: UpdateMealPatternEntryRequest =
        serde_json::from_str(json).expect("all fields optional");
    assert!(req.name.is_none());
    assert!(req.preferred_time.is_none());
    assert!(req.tolerance_minutes.is_none());
    assert!(req.sort_order.is_none());
}

#[test]
fn update_request_with_all_fields() {
    let json = r#"{"name":"Second Breakfast","preferred_time":"10:00","tolerance_minutes":15,"sort_order":2}"#;
    let req: UpdateMealPatternEntryRequest =
        serde_json::from_str(json).expect("full update should deserialize");
    assert_eq!(req.name.as_deref(), Some("Second Breakfast"));
    assert!(req.preferred_time.is_some());
    assert!(req.preferred_time.unwrap().to_string().starts_with("10:00"));
    assert_eq!(req.tolerance_minutes, Some(15));
    assert_eq!(req.sort_order, Some(2));
}

#[test]
fn update_request_invalid_time_format_fails() {
    let json = r#"{"preferred_time":"not-a-time"}"#;
    assert!(serde_json::from_str::<UpdateMealPatternEntryRequest>(json).is_err());
}

// --- Constants ---

#[test]
fn max_name_len_is_200() {
    assert_eq!(MAX_NAME_LEN, 200);
}
