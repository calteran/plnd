use plnd_api::routes::day_types::{CreateDayTypeRequest, MAX_NAME_LEN, UpdateDayTypeRequest};

// ---------------------------------------------------------------------------
// CreateDayTypeRequest — serde round-trips
// ---------------------------------------------------------------------------

#[test]
fn create_request_non_cycle_deserializes() {
    let json = r#"{
        "name": "Weekdays",
        "days_bitmask": 62,
        "wake_time": "07:00",
        "sleep_time": "22:00",
        "is_cycle": false
    }"#;
    let req: CreateDayTypeRequest = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(req.name, "Weekdays");
    assert_eq!(req.days_bitmask, 62);
    assert!(req.wake_time.to_string().starts_with("07:00"));
    assert!(req.sleep_time.to_string().starts_with("22:00"));
    assert!(!req.is_cycle);
    assert!(req.cycle_length.is_none());
    assert!(req.anchor_date.is_none());
}

#[test]
fn create_request_accepts_hms_time_format() {
    let json = r#"{
        "name": "Weekdays",
        "days_bitmask": 62,
        "wake_time": "07:00:00",
        "sleep_time": "22:30:00",
        "is_cycle": false
    }"#;
    let req: CreateDayTypeRequest = serde_json::from_str(json).expect("HH:MM:SS format failed");
    assert!(req.wake_time.to_string().starts_with("07:00"));
    assert!(req.sleep_time.to_string().starts_with("22:30"));
}

#[test]
fn create_request_cycle_type_deserializes() {
    let json = r#"{
        "name": "10-Day Cycle",
        "days_bitmask": 0,
        "wake_time": "06:30",
        "sleep_time": "22:00",
        "is_cycle": true,
        "cycle_length": 10,
        "anchor_date": "2026-01-06"
    }"#;
    let req: CreateDayTypeRequest = serde_json::from_str(json).expect("cycle deserialize failed");
    assert!(req.is_cycle);
    assert_eq!(req.cycle_length, Some(10));
    assert!(req.anchor_date.is_some());
    // cycle_bitmask is optional — defaults to None on the request, then
    // resolved to full coverage by the handler.
    assert!(req.cycle_bitmask.is_none());
}

#[test]
fn create_request_cycle_with_partition_bitmask_deserializes() {
    let json = r#"{
        "name": "Day Shift",
        "days_bitmask": 0,
        "wake_time": "06:30",
        "sleep_time": "22:00",
        "is_cycle": true,
        "cycle_length": 4,
        "anchor_date": "2026-05-11",
        "cycle_bitmask": 1
    }"#;
    let req: CreateDayTypeRequest =
        serde_json::from_str(json).expect("partition deserialize failed");
    assert_eq!(req.cycle_bitmask, Some(1));
}

#[test]
fn create_request_missing_name_fails() {
    let json = r#"{"days_bitmask":62,"wake_time":"07:00","sleep_time":"22:00","is_cycle":false}"#;
    assert!(serde_json::from_str::<CreateDayTypeRequest>(json).is_err());
}

#[test]
fn create_request_missing_days_bitmask_fails() {
    let json = r#"{"name":"Weekdays","wake_time":"07:00","sleep_time":"22:00","is_cycle":false}"#;
    assert!(serde_json::from_str::<CreateDayTypeRequest>(json).is_err());
}

#[test]
fn create_request_missing_wake_time_fails() {
    let json = r#"{"name":"Weekdays","days_bitmask":62,"sleep_time":"22:00","is_cycle":false}"#;
    assert!(serde_json::from_str::<CreateDayTypeRequest>(json).is_err());
}

#[test]
fn create_request_invalid_time_format_fails() {
    let json = r#"{"name":"Weekdays","days_bitmask":62,"wake_time":"7am","sleep_time":"22:00","is_cycle":false}"#;
    assert!(serde_json::from_str::<CreateDayTypeRequest>(json).is_err());
}

// ---------------------------------------------------------------------------
// UpdateDayTypeRequest
// ---------------------------------------------------------------------------

#[test]
fn update_request_deserializes() {
    let json = r#"{
        "name": "Weekends",
        "days_bitmask": 65,
        "wake_time": "09:00",
        "sleep_time": "23:30",
        "is_cycle": false
    }"#;
    let req: UpdateDayTypeRequest = serde_json::from_str(json).expect("update deserialize failed");
    assert_eq!(req.name, "Weekends");
    assert_eq!(req.days_bitmask, 65);
    assert!(req.wake_time.to_string().starts_with("09:00"));
}

// ---------------------------------------------------------------------------
// Constant assertions
// ---------------------------------------------------------------------------

#[test]
fn max_name_len_is_expected_value() {
    assert_eq!(MAX_NAME_LEN, 200);
}
