use chrono::NaiveTime;
use plnd_api::models::PatchPreferencesRequest;

#[test]
fn test_patch_preferences_request_scheduling_fields() {
    let json = r#"{"week_start_day":1,"planning_trigger_offset":-1,"default_plan_length_days":7}"#;
    let req: PatchPreferencesRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.week_start_day, Some(1));
    assert_eq!(req.planning_trigger_offset, Some(-1));
    assert_eq!(req.default_plan_length_days, Some(7));
    assert!(req.planning_time.is_none());
}

#[test]
fn test_patch_preferences_request_planning_time() {
    let json = r#"{"planning_time":"09:30"}"#;
    let req: PatchPreferencesRequest = serde_json::from_str(json).unwrap();
    assert_eq!(
        req.planning_time,
        Some(NaiveTime::from_hms_opt(9, 30, 0).unwrap())
    );
    assert!(req.week_start_day.is_none());
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
