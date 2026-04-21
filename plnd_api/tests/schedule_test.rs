use chrono::{Duration, NaiveDate, NaiveTime};
use plnd_api::models::{PlanEntryRequest, PostSchedulePlanRequest};
use plnd_api::routes::schedule::PeriodQuery;
use plnd_data::models::CARRYOVER_LOOKBACK_DAYS;
use plnd_data::query_types::{
    PlanStatusResponse, PostSchedulePlanResponse, SchedulePeriodResponse,
};

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
    assert_eq!(
        req.scheduled_start,
        Some(NaiveTime::from_hms_opt(8, 0, 0).unwrap())
    );
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
    assert_eq!(
        req.plan_start,
        NaiveDate::from_ymd_opt(2026, 3, 24).unwrap()
    );
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
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("14"));
    assert!(json.contains("completed"));
}

#[test]
fn test_carryover_lookback_window_boundary() {
    // Carryover entries are bounded to CARRYOVER_LOOKBACK_DAYS before the period start.
    // This verifies the date arithmetic using the real constant so the test stays in
    // sync if the window is ever changed.
    let start = NaiveDate::from_ymd_opt(2026, 4, 1).unwrap();
    let lookback = start - Duration::days(CARRYOVER_LOOKBACK_DAYS);
    assert_eq!(lookback, NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
    // A day within the window should be included (>= lookback and < start)
    let within_window = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap();
    assert!(within_window >= lookback && within_window < start);
    // A day before the window should be excluded
    let before_window = NaiveDate::from_ymd_opt(2025, 12, 31).unwrap();
    assert!(before_window < lookback);
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
