use plnd_api::auth::SessionService;
use uuid::Uuid;

#[tokio::test]
async fn test_session_creation() {
    let session_service = SessionService::new();
    let user_id = Uuid::parse_str("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11").unwrap();

    let session_id = session_service
        .create_session(
            user_id,
            "mock-token-hash",
            Some("192.168.1.1"),
            Some("Mozilla/5.0"),
        )
        .await
        .expect("Failed to create session");

    assert!(!session_id.is_empty());
    // UUID should be 36 characters
    assert_eq!(session_id.len(), 36);
}

#[tokio::test]
async fn test_session_validation() {
    let session_service = SessionService::new();

    // Stub mode always returns true
    let valid_session_id = "550e8400-e29b-41d4-a716-446655440000";
    let is_valid = session_service.validate_session(valid_session_id).await;

    assert!(is_valid.expect("Failed to validate session"));
}

#[tokio::test]
async fn test_session_revocation() {
    let session_service = SessionService::new();

    let session_id = "550e8400-e29b-41d4-a716-446655440000";
    let result = session_service.revoke_session(session_id).await;

    assert!(result.is_ok());
}
