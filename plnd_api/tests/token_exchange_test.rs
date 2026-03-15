/// Offline unit tests for the token exchange flow.
/// These tests do not require a database or network connection.
use plnd_api::auth::jwks::IdTokenClaims;
use plnd_api::auth::{JwksCache, JwtService, SessionService};
use plnd_api::routes::auth::{TokenExchangeRequest, TokenExchangeResponse};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Serde round-trip tests
// ---------------------------------------------------------------------------

#[test]
fn test_token_exchange_request_serde() {
    let req = TokenExchangeRequest {
        id_token: "header.payload.signature".to_string(),
        provider: "mock".to_string(),
    };
    let json = serde_json::to_string(&req).unwrap();
    let decoded: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded["id_token"], "header.payload.signature");
    assert_eq!(decoded["provider"], "mock");
}

#[test]
fn test_token_exchange_response_serde() {
    let resp = TokenExchangeResponse {
        access_token: "eyJhbGciOiJIUzI1NiJ9.test.sig".to_string(),
        token_type: "Bearer".to_string(),
        expires_in: 86400,
    };
    let json = serde_json::to_string(&resp).unwrap();
    let decoded: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded["token_type"], "Bearer");
    assert_eq!(decoded["expires_in"], 86400);
    assert!(decoded["access_token"].as_str().unwrap().starts_with("eyJ"));
}

#[test]
fn test_id_token_claims_serde_with_string_aud() {
    let json = r#"{
        "sub": "user-abc",
        "email": "user@example.com",
        "name": "Test User",
        "picture": null,
        "email_verified": true,
        "aud": "mock-client",
        "iss": "http://localhost:8080/plnd-dev",
        "exp": 9999999999,
        "iat": 1700000000
    }"#;
    let claims: IdTokenClaims = serde_json::from_str(json).unwrap();
    assert_eq!(claims.sub, "user-abc");
    assert_eq!(claims.email.unwrap(), "user@example.com");
    assert!(claims.aud.is_string());
}

#[test]
fn test_id_token_claims_serde_with_array_aud() {
    let json = r#"{
        "sub": "user-xyz",
        "aud": ["mock-client", "another-client"],
        "iss": "http://localhost:8080/plnd-dev",
        "exp": 9999999999,
        "iat": 1700000000
    }"#;
    let claims: IdTokenClaims = serde_json::from_str(json).unwrap();
    assert_eq!(claims.sub, "user-xyz");
    assert!(claims.aud.is_array());
    assert_eq!(claims.aud.as_array().unwrap().len(), 2);
}

// ---------------------------------------------------------------------------
// JwtService — JTI is a valid UUID
// ---------------------------------------------------------------------------

#[test]
fn test_jti_is_valid_uuid() {
    let svc = JwtService::new("test-secret-long-enough".to_string(), 3600);
    let jwt = svc
        .generate_token("user-123", "test@example.com", None, None)
        .unwrap();
    let claims = svc.validate_token(&jwt).unwrap();
    assert!(
        Uuid::parse_str(&claims.jti).is_ok(),
        "jti '{}' should be a valid UUID",
        claims.jti
    );
}

// ---------------------------------------------------------------------------
// SessionService stub always returns Ok(true)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_session_stub_always_valid() {
    let svc = SessionService::new();
    let result = svc.validate_session("any-jti-value").await;
    assert!(result.is_ok());
    assert!(result.unwrap());
}

// ---------------------------------------------------------------------------
// JwksCache construction does not panic
// ---------------------------------------------------------------------------

#[test]
fn test_jwks_cache_constructs() {
    let _cache = JwksCache::new(
        "http://localhost:8080/plnd-dev".to_string(),
        "http://localhost:8080/plnd-dev".to_string(),
    );
    // No panic = pass
}
