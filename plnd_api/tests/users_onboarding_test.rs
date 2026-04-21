use chrono::Utc;
use plnd_data::models::User;
use uuid::Uuid;

fn make_user(onboarding_completed: bool) -> User {
    User {
        user_id: Uuid::new_v4(),
        email: "test@example.com".to_string(),
        display_name: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        is_active: true,
        last_login: None,
        avatar_url: None,
        onboarding_completed,
    }
}

#[test]
fn test_user_serializes_onboarding_completed_true() {
    let user = make_user(true);
    let json = serde_json::to_value(&user).expect("serialize failed");
    assert_eq!(json["onboarding_completed"], true);
}

#[test]
fn test_user_serializes_onboarding_completed_false() {
    let user = make_user(false);
    let json = serde_json::to_value(&user).expect("serialize failed");
    assert_eq!(json["onboarding_completed"], false);
}

#[test]
fn test_user_deserializes_onboarding_completed_true() {
    let json = r#"{
        "user_id": "00000000-0000-0000-0000-000000000001",
        "email": "alice@example.com",
        "display_name": null,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "is_active": true,
        "last_login": null,
        "avatar_url": null,
        "onboarding_completed": true
    }"#;
    let user: User = serde_json::from_str(json).expect("deserialize failed");
    assert!(user.onboarding_completed);
}

#[test]
fn test_user_deserializes_onboarding_completed_false() {
    let json = r#"{
        "user_id": "00000000-0000-0000-0000-000000000002",
        "email": "bob@example.com",
        "display_name": null,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "is_active": false,
        "last_login": null,
        "avatar_url": null,
        "onboarding_completed": false
    }"#;
    let user: User = serde_json::from_str(json).expect("deserialize failed");
    assert!(!user.onboarding_completed);
}
