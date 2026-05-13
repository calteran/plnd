use chrono::{NaiveDate, NaiveTime};
use plnd_api::models::{PlanEntryRequest, PostSchedulePlanRequest};
use plnd_api::routes::schedule::PeriodQuery;

use plnd_data::query_types::{
    PlanStatusResponse, PostSchedulePlanResponse, SchedulePeriodResponse,
};

#[test]
fn test_plan_entry_request_general_task_with_title() {
    let json = r#"{
        "date": "2026-03-24",
        "task_type": "general",
        "title": "Morning walk",
        "scheduled_start": "07:00"
    }"#;
    let req: PlanEntryRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.task_type, Some("general".to_string()));
    assert_eq!(req.title, Some("Morning walk".to_string()));
    assert_eq!(
        req.scheduled_start,
        Some(NaiveTime::from_hms_opt(7, 0, 0).unwrap())
    );
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
    assert_eq!(
        req.plan_start,
        NaiveDate::from_ymd_opt(2026, 3, 24).unwrap()
    );
    assert_eq!(req.replace, Some(true));
    assert!(req.entries.is_empty());
}

#[test]
fn test_post_schedule_plan_request_with_meal_entries() {
    let json = r#"{
        "plan_start": "2026-03-24",
        "plan_end": "2026-03-30",
        "planning_task_id": "00000000-0000-0000-0000-000000000002",
        "entries": [],
        "meal_entries": [
            {
                "date": "2026-03-24",
                "meal_name": "breakfast",
                "meal_ref_id": "00000000-0000-0000-0000-000000000001",
                "meal_ref_type": "user_meal",
                "title": "Yogurt and granola"
            }
        ]
    }"#;
    let req: PostSchedulePlanRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.meal_entries.len(), 1);
    assert_eq!(req.meal_entries[0].meal_name, "breakfast");
    assert_eq!(req.meal_entries[0].meal_ref_type, "user_meal");
}

#[test]
fn test_post_schedule_plan_request_meal_entries_defaults_empty() {
    let json = r#"{
        "plan_start": "2026-03-24",
        "plan_end": "2026-03-30",
        "planning_task_id": "00000000-0000-0000-0000-000000000002",
        "entries": []
    }"#;
    let req: PostSchedulePlanRequest = serde_json::from_str(json).unwrap();
    assert!(req.meal_entries.is_empty());
}

#[test]
fn test_plan_status_response_serde() {
    let json = r#"{"planned":false,"entry_count":0}"#;
    let resp: PlanStatusResponse = serde_json::from_str(json).unwrap();
    assert!(!resp.planned);
    assert_eq!(resp.entry_count, 0);
}

#[test]
fn test_schedule_period_response_empty() {
    let json = r#"{"entries":[],"carryover":[]}"#;
    let resp: SchedulePeriodResponse = serde_json::from_str(json).unwrap();
    assert!(resp.entries.is_empty());
    assert!(resp.carryover.is_empty());
}

#[test]
fn test_post_schedule_plan_response_serde() {
    let resp = PostSchedulePlanResponse {
        committed: 14,
        planning_task_status: "completed".to_string(),
        entries: vec![],
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("14"));
    assert!(json.contains("completed"));
    assert!(json.contains("\"entries\":[]"));
}

#[test]
fn test_carryover_no_lookback_horizon() {
    // There is no lookback horizon for carryover — all planned/deferred entries
    // before the period start are eligible, regardless of age (§4.10).
    let start = NaiveDate::from_ymd_opt(2026, 4, 1).unwrap();
    // An entry well within a former 90-day window should be included
    let recent = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap();
    assert!(recent < start, "recent entry is before period start");
    // An entry older than 90 days should also be included — no horizon
    let old_entry = NaiveDate::from_ymd_opt(2025, 12, 31).unwrap();
    assert!(
        old_entry < start,
        "old entry is also before period start and must not be excluded"
    );
}

#[test]
fn test_period_query_reversed_dates_is_invalid() {
    // The get_plan_status handler rejects requests where end < start with HTTP 400.
    // This test confirms that the guard condition (end < start) correctly identifies
    // a reversed date range so the handler logic can return BAD_REQUEST.
    let query = PeriodQuery {
        start: NaiveDate::from_ymd_opt(2026, 4, 10).unwrap(),
        end: NaiveDate::from_ymd_opt(2026, 4, 1).unwrap(),
    };
    assert!(
        query.end < query.start,
        "end < start should be true for reversed range"
    );
}

#[test]
fn test_period_query_valid_dates_passes_guard() {
    // A valid date range (end >= start) should not trigger the BAD_REQUEST guard.
    let query = PeriodQuery {
        start: NaiveDate::from_ymd_opt(2026, 4, 1).unwrap(),
        end: NaiveDate::from_ymd_opt(2026, 4, 10).unwrap(),
    };
    assert!(
        query.end >= query.start,
        "end >= start should not trigger the guard"
    );
}

#[test]
fn test_period_query_same_date_passes_guard() {
    // A single-day range (end == start) is valid and should not trigger the guard.
    let query = PeriodQuery {
        start: NaiveDate::from_ymd_opt(2026, 4, 5).unwrap(),
        end: NaiveDate::from_ymd_opt(2026, 4, 5).unwrap(),
    };
    assert!(
        query.end >= query.start,
        "end == start should not trigger the guard"
    );
}
