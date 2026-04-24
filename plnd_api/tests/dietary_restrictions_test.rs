use plnd_api::routes::dietary_restrictions::{
    CreateRestrictionRequest, MAX_NAME_LEN, MAX_NOTES_LEN, UpdateRestrictionRequest, VALID_TYPES,
};

// --- CreateRestrictionRequest ---

#[test]
fn test_create_request_required_fields_only() {
    let json = r#"{"restriction_type":"allergy","name":"peanuts"}"#;
    let req: CreateRestrictionRequest = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(req.restriction_type, "allergy");
    assert_eq!(req.name, "peanuts");
    assert!(req.notes.is_none());
}

#[test]
fn test_create_request_with_notes() {
    let json = r#"{"restriction_type":"intolerance","name":"lactose","notes":"even small amounts cause issues"}"#;
    let req: CreateRestrictionRequest = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(req.restriction_type, "intolerance");
    assert_eq!(req.name, "lactose");
    assert_eq!(
        req.notes.as_deref(),
        Some("even small amounts cause issues")
    );
}

#[test]
fn test_create_request_missing_restriction_type_fails() {
    let json = r#"{"name":"peanuts"}"#;
    let result: Result<CreateRestrictionRequest, _> = serde_json::from_str(json);
    assert!(
        result.is_err(),
        "expected error when restriction_type is missing"
    );
}

#[test]
fn test_create_request_missing_name_fails() {
    let json = r#"{"restriction_type":"allergy"}"#;
    let result: Result<CreateRestrictionRequest, _> = serde_json::from_str(json);
    assert!(result.is_err(), "expected error when name is missing");
}

// --- UpdateRestrictionRequest ---

#[test]
fn test_update_request_empty_body() {
    let json = "{}";
    let req: UpdateRestrictionRequest = serde_json::from_str(json).expect("deserialize failed");
    assert!(req.notes.is_none());
}

#[test]
fn test_update_request_notes_only() {
    let json = r#"{"notes":"even traces cause a reaction"}"#;
    let req: UpdateRestrictionRequest = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(req.notes.as_deref(), Some("even traces cause a reaction"));
}

// --- Constant assertions ---

#[test]
fn test_valid_types_has_four_values() {
    assert_eq!(VALID_TYPES.len(), 4);
    assert!(VALID_TYPES.contains(&"allergy"));
    assert!(VALID_TYPES.contains(&"intolerance"));
    assert!(VALID_TYPES.contains(&"preference"));
    assert!(VALID_TYPES.contains(&"cultural_religious"));
}

#[test]
fn test_max_name_len() {
    assert_eq!(MAX_NAME_LEN, 100);
}

#[test]
fn test_max_notes_len() {
    assert_eq!(MAX_NOTES_LEN, 500);
}
