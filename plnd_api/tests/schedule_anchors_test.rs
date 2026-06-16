use chrono::NaiveTime;
use plnd_api::api_response::{ScheduleAnchorKind, ScheduleAnchorResponse};

fn t(s: &str) -> NaiveTime {
    NaiveTime::parse_from_str(s, "%H:%M:%S").unwrap()
}

#[test]
fn kind_serializes_snake_case() {
    assert_eq!(
        serde_json::to_string(&ScheduleAnchorKind::ScheduledTask).unwrap(),
        "\"scheduled_task\""
    );
    assert_eq!(
        serde_json::to_string(&ScheduleAnchorKind::StartOfDay).unwrap(),
        "\"start_of_day\""
    );
    assert_eq!(
        serde_json::to_string(&ScheduleAnchorKind::TimezoneChange).unwrap(),
        "\"timezone_change\""
    );
}

#[test]
fn start_of_day_response_serializes_null_meal_fields() {
    let resp = ScheduleAnchorResponse {
        kind: ScheduleAnchorKind::StartOfDay,
        sequence: 0,
        time: t("07:00:00"),
        label: "start of day".to_string(),
        id: None,
        status: None,
        consumed_at: None,
        tolerance_minutes: None,
        sort_order: None,
        template_entry_id: None,
        zone: None,
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"kind\":\"start_of_day\""));
    assert!(json.contains("\"sequence\":0"));
    assert!(json.contains("\"id\":null"));
    assert!(json.contains("\"status\":null"));
    assert!(json.contains("\"zone\":null"));
}

#[test]
fn meal_response_carries_meal_fields() {
    let resp = ScheduleAnchorResponse {
        kind: ScheduleAnchorKind::Meal,
        sequence: 1,
        time: t("08:00:00"),
        label: "Breakfast".to_string(),
        id: Some(uuid::Uuid::nil()),
        status: Some("planned".to_string()),
        consumed_at: None,
        tolerance_minutes: Some(60),
        sort_order: Some(0),
        template_entry_id: None,
        zone: None,
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"kind\":\"meal\""));
    assert!(json.contains("\"status\":\"planned\""));
    assert!(json.contains("\"tolerance_minutes\":60"));
}

#[test]
fn timezone_change_response_carries_zone() {
    let resp = ScheduleAnchorResponse {
        kind: ScheduleAnchorKind::TimezoneChange,
        sequence: 3,
        time: t("14:00:00"),
        label: "America/Denver".to_string(),
        id: Some(uuid::Uuid::nil()),
        status: None,
        consumed_at: None,
        tolerance_minutes: None,
        sort_order: None,
        template_entry_id: None,
        zone: Some("America/Denver".to_string()),
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"kind\":\"timezone_change\""));
    assert!(json.contains("\"zone\":\"America/Denver\""));
}
