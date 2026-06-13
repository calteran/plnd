use plnd_seed::dishes::{AUTO_SEEDED_TAG, DISH_TERMS};
use plnd_seed::error::SeedError;

#[test]
fn test_dish_terms_non_empty() {
    assert!(
        !DISH_TERMS.is_empty(),
        "DISH_TERMS must have at least one entry"
    );
    for term in DISH_TERMS {
        assert!(
            !term.is_empty(),
            "Each dish term must be a non-empty string"
        );
    }
}

#[test]
fn test_seed_error_display() {
    let err = SeedError::ProviderError("test error".to_string());
    let msg = err.to_string();
    assert!(
        !msg.is_empty(),
        "SeedError display must produce a non-empty message"
    );
    assert!(
        msg.contains("test error"),
        "SeedError message should include the inner error text"
    );
}

#[test]
fn test_tags_include_auto_seeded() {
    assert_eq!(AUTO_SEEDED_TAG, "auto-seeded");
    // Verify the tag would appear in a dish tags vector
    let tags = [AUTO_SEEDED_TAG.to_string()];
    assert!(tags.contains(&"auto-seeded".to_string()));
}
