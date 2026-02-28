use plnd_api::auth::SessionService;

#[tokio::test]
async fn test_session_creation() {
    let session_service = SessionService::new();

    let session_id = session_service
        .create_session("user123", Some("192.168.1.1"), Some("Mozilla/5.0"))
        .await
        .expect("Failed to create session");

    assert!(!session_id.is_empty());
    // UUID should be 36 characters
    assert_eq!(session_id.len(), 36);
}

#[tokio::test]
async fn test_session_validation() {
    let session_service = SessionService::new();

    // Test with a valid session ID format (UUID)
    let valid_session_id = "550e8400-e29b-41d4-a716-446655440000";
    let is_valid = session_service.validate_session(valid_session_id).await;

    // Currently this always returns true as it's a mock implementation
    assert!(is_valid.expect("Failed to validate session"));
}

#[tokio::test]
async fn test_session_revocation() {
    let session_service = SessionService::new();

    let session_id = "550e8400-e29b-41d4-a716-446655440000";
    let result = session_service.revoke_session(session_id).await;

    // Currently this always succeeds as it's a mock implementation
    assert!(result.is_ok());
}
