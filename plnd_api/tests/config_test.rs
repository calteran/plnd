#[test]
fn test_load_config() {
    let config = plnd_api::config::load_config_with_path("").expect("Failed to load config");

    // Test that we can load the configuration
    assert_eq!(config.api.base_url, "0.0.0.0:3000");
    assert_eq!(config.api.timeout, 60000); // Should be overridden by development.toml
    assert_eq!(
        config.database.url,
        "postgres://plnd:plnd_dev@localhost/plnd_dev"
    );
    assert_eq!(config.database.max_connections, 10);
    assert_eq!(
        config.logging.level,
        "debug,h2=warn,hyper_util=warn,tonic=warn,tower=warn,opentelemetry_sdk=warn"
    ); // Should be overridden by development.toml
    assert!(config.logging.pretty_print);
}

#[test]
fn test_llm_max_iterations_from_config() {
    let config = plnd_api::config::load_config_with_path("").expect("Failed to load config");

    assert_eq!(config.llm.fast.max_iterations, 10);
    assert_eq!(config.llm.capable.max_iterations, 10);
}

#[test]
fn test_config_validation() {
    let config = plnd_api::config::load_config_with_path("").expect("Failed to load config");

    // Test that validation passes
    assert!(config.validate().is_ok());
}
