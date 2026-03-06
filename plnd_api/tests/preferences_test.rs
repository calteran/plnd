use plnd_api::routes::preferences::UpdatePreferencesRequest;

#[test]
fn test_update_preferences_request_empty() {
    let json = "{}";
    let req: UpdatePreferencesRequest = serde_json::from_str(json).expect("deserialize failed");
    assert!(req.theme.is_none());
}

#[test]
fn test_update_preferences_request_theme_dark() {
    let json = r#"{"theme":"dark"}"#;
    let req: UpdatePreferencesRequest = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(req.theme.as_deref(), Some("dark"));
}
