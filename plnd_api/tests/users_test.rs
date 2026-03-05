use plnd_api::auth::JwtService;
use plnd_api::routes::users::UpdateProfileRequest;

// ---------------------------------------------------------------------------
// UpdateProfileRequest deserialization
// ---------------------------------------------------------------------------

#[test]
fn test_update_profile_request_all_absent() {
    let json = "{}";
    let req: UpdateProfileRequest = serde_json::from_str(json).expect("deserialize failed");
    assert!(req.display_name.is_none());
    assert!(req.profile_picture_url.is_none());
}

#[test]
fn test_update_profile_request_display_name_only() {
    let json = r#"{"display_name":"Alice"}"#;
    let req: UpdateProfileRequest = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(req.display_name.as_deref(), Some("Alice"));
    assert!(req.profile_picture_url.is_none());
}

#[test]
fn test_update_profile_request_both_fields() {
    let json = r#"{"display_name":"Bob","profile_picture_url":"https://example.com/bob.jpg"}"#;
    let req: UpdateProfileRequest = serde_json::from_str(json).expect("deserialize failed");
    assert_eq!(req.display_name.as_deref(), Some("Bob"));
    assert_eq!(
        req.profile_picture_url.as_deref(),
        Some("https://example.com/bob.jpg")
    );
}

// ---------------------------------------------------------------------------
// JWT / middleware validation logic (offline, no live server needed)
// ---------------------------------------------------------------------------

#[test]
fn test_middleware_rejects_invalid_jwt() {
    let jwt = JwtService::new("test-secret".to_string(), 3600);
    let result = jwt.validate_token("not.a.valid.jwt");
    assert!(result.is_err(), "expected Err for malformed token");
}

#[test]
fn test_middleware_rejects_wrong_secret() {
    let signer = JwtService::new("correct-secret".to_string(), 3600);
    let verifier = JwtService::new("wrong-secret".to_string(), 3600);

    let token = signer
        .generate_token("user-uuid", "user@example.com", None, None)
        .expect("token generation failed");

    let result = verifier.validate_token(&token);
    assert!(
        result.is_err(),
        "expected Err for wrong-secret verification"
    );
}

#[test]
fn test_middleware_accepts_valid_jwt() {
    let jwt = JwtService::new("shared-secret".to_string(), 3600);

    let token = jwt
        .generate_token("user-uuid", "user@example.com", Some("Alice"), None)
        .expect("token generation failed");

    let claims = jwt.validate_token(&token).expect("valid token should pass");
    assert_eq!(claims.sub, "user-uuid");
    assert_eq!(claims.email, "user@example.com");
    assert_eq!(claims.name.as_deref(), Some("Alice"));
}

#[test]
fn test_bearer_prefix_stripping() {
    // Simulate the header parsing logic from auth_middleware
    let header_value = "Bearer sometoken123";
    let token = header_value
        .strip_prefix("Bearer ")
        .expect("should strip Bearer prefix");
    assert_eq!(token, "sometoken123");

    let bad_header = "Basic sometoken123";
    assert!(
        bad_header.strip_prefix("Bearer ").is_none(),
        "non-Bearer auth should fail"
    );
}
