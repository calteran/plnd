use plnd_api::db::models::{PostSchedulePlanRequest, PlanEntryRequest, PlanStatusResponse};
use chrono::NaiveDate;

#[test]
fn test_plan_entry_request_serde() {
    let json = r#"{
        "date": "2026-03-24",
        "task_type": "meal",
        "task_ref_id": "00000000-0000-0000-0000-000000000001",
        "task_ref_type": "user_meal",
        "scheduled_start": "08:00",
        "after_milepost": "breakfast"
    }"#;
    let req: PlanEntryRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.task_type, "meal");
    assert_eq!(req.scheduled_start, "08:00");
    assert_eq!(req.after_milepost, Some("breakfast".to_string()));
    assert!(req.title.is_none());
}

#[test]
fn test_plan_entry_request_custom_task_with_title() {
    let json = r#"{
        "date": "2026-03-24",
        "task_type": "custom",
        "title": "Morning walk",
        "scheduled_start": "07:00"
    }"#;
    let req: PlanEntryRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.task_type, "custom");
    assert_eq!(req.title, Some("Morning walk".to_string()));
    assert!(req.task_ref_id.is_none());
}

#[test]
fn test_post_schedule_plan_request_serde() {
    let json = r#"{
        "plan_start": "2026-03-24",
        "plan_end": "2026-03-30",
        "planning_task_id": "00000000-0000-0000-0000-000000000002",
        "entries": [],
        "replace": true
    }"#;
    let req: PostSchedulePlanRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.plan_start, NaiveDate::from_ymd_opt(2026, 3, 24).unwrap());
    assert_eq!(req.replace, Some(true));
    assert!(req.entries.is_empty());
}

#[test]
fn test_plan_status_response_serde() {
    let json = r#"{"planned":false,"entry_count":0}"#;
    let resp: PlanStatusResponse = serde_json::from_str(json).unwrap();
    assert!(!resp.planned);
    assert_eq!(resp.entry_count, 0);
}
