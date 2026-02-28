use plnd_api::auth::{AuthError, JwtService};

#[tokio::test]
async fn test_jwt_generation_and_validation() {
    let jwt_service = JwtService::new("test_secret_key_12345".to_string(), 3600);

    // Test token generation
    let token = jwt_service
        .generate_token(
            "user123",
            "test@example.com",
            Some("Test User"),
            Some("https://example.com/picture.jpg"),
        )
        .expect("Failed to generate token");

    assert!(!token.is_empty());

    // Test token validation
    let claims = jwt_service
        .validate_token(&token)
        .expect("Failed to validate token");

    assert_eq!(claims.sub, "user123");
    assert_eq!(claims.email, "test@example.com");
    assert_eq!(claims.name, Some("Test User".to_string()));
    assert_eq!(
        claims.picture,
        Some("https://example.com/picture.jpg".to_string())
    );
}

#[tokio::test]
async fn test_jwt_invalid_token() {
    let jwt_service = JwtService::new("test_secret_key_12345".to_string(), 3600);

    // Test with invalid token
    let result = jwt_service.validate_token("invalid_token");

    assert!(matches!(result, Err(AuthError::JwtError(_))));
}

#[tokio::test]
async fn test_jwt_different_secret() {
    let jwt_service1 = JwtService::new("secret1".to_string(), 3600);
    let jwt_service2 = JwtService::new("secret2".to_string(), 3600);

    // Generate token with first service
    let token = jwt_service1
        .generate_token("user123", "test@example.com", None, None)
        .expect("Failed to generate token");

    // Try to validate with different secret - should fail
    let result = jwt_service2.validate_token(&token);

    assert!(matches!(result, Err(AuthError::JwtError(_))));
}

#[tokio::test]
async fn test_refresh_token_generation() {
    let jwt_service = JwtService::new("test_secret_key_12345".to_string(), 3600);

    let refresh_token = jwt_service.generate_refresh_token();

    assert!(!refresh_token.is_empty());
    // UUID v4 should be 36 characters (32 hex + 4 hyphens)
    assert_eq!(refresh_token.len(), 36);
}
