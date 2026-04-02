use plnd_api::models::PatchPreferencesRequest;

#[test]
fn test_patch_preferences_request_all_fields() {
    let json = r#"{"week_start_day":1,"planning_trigger_offset":-1,"default_plan_length_days":7}"#;
    let req: PatchPreferencesRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.week_start_day, Some(1));
    assert_eq!(req.planning_trigger_offset, Some(-1));
    assert_eq!(req.default_plan_length_days, Some(7));
}

#[test]
fn test_patch_preferences_request_partial() {
    let json = r#"{"week_start_day":0}"#;
    let req: PatchPreferencesRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.week_start_day, Some(0));
    assert!(req.planning_trigger_offset.is_none());
    assert!(req.default_plan_length_days.is_none());
}

#[test]
fn test_patch_preferences_request_empty() {
    let json = r#"{}"#;
    let req: PatchPreferencesRequest = serde_json::from_str(json).unwrap();
    assert!(req.week_start_day.is_none());
    assert!(req.planning_trigger_offset.is_none());
    assert!(req.default_plan_length_days.is_none());
}
