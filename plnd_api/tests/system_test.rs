use plnd_api::routes::system::ClientErrorPayload;

#[test]
fn test_client_error_payload_minimal_valid() {
    let json = r#"{
        "message": "Uncaught ReferenceError: foo is not defined",
        "timestamp": "2026-04-02T10:00:00Z",
        "user_agent": "Mozilla/5.0"
    }"#;
    let payload: ClientErrorPayload = serde_json::from_str(json).expect("should parse");
    assert_eq!(payload.message, "Uncaught ReferenceError: foo is not defined");
    assert!(payload.stack.is_none());
    assert!(payload.url.is_none());
    assert!(payload.request_id.is_none());
}

#[test]
fn test_client_error_payload_full() {
    let json = r#"{
        "message": "TypeError: Cannot read properties of null",
        "stack": "TypeError: Cannot read...\n    at Component.ngOnInit",
        "url": "/dashboard",
        "request_id": "550e8400-e29b-41d4-a716-446655440000",
        "timestamp": "2026-04-02T10:00:00Z",
        "user_agent": "Mozilla/5.0"
    }"#;
    let payload: ClientErrorPayload = serde_json::from_str(json).expect("should parse");
    assert_eq!(payload.message, "TypeError: Cannot read properties of null");
    assert!(payload.stack.is_some());
    assert_eq!(payload.request_id.as_deref(), Some("550e8400-e29b-41d4-a716-446655440000"));
}

#[test]
fn test_client_error_payload_missing_message_fails() {
    let json = r#"{
        "timestamp": "2026-04-02T10:00:00Z",
        "user_agent": "Mozilla/5.0"
    }"#;
    let result: Result<ClientErrorPayload, _> = serde_json::from_str(json);
    assert!(result.is_err(), "message is required — should fail without it");
}

#[test]
fn test_client_error_payload_missing_timestamp_fails() {
    let json = r#"{
        "message": "Error",
        "user_agent": "Mozilla/5.0"
    }"#;
    let result: Result<ClientErrorPayload, _> = serde_json::from_str(json);
    assert!(result.is_err(), "timestamp is required — should fail without it");
}
