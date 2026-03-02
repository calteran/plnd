pub mod error;
pub mod settings;

use config::{Config, File};
use dotenv::dotenv;
pub use settings::AppConfig;

pub fn load_config() -> Result<AppConfig, error::ConfigError> {
    load_config_with_path("")
}

/// Load configuration with optional path prefix for tests
pub fn load_config_with_path(path: &str) -> Result<AppConfig, error::ConfigError> {
    // Load .env file if it exists
    dotenv().ok();

    let builder = Config::builder()
        // Load default configuration (required)
        .add_source(File::with_name(&format!("{}{}", path, "config/api/default")).required(true))
        // Load environment-specific configuration (optional)
        .add_source(
            File::with_name(&format!("{}{}", path, "config/api/development")).required(false),
        );

    let config = builder.build()?;

    // Manually override with environment variables if they exist
    // This is needed because the config library's environment variable parsing
    // with double underscore separator is not working as expected
    let mut app_config: AppConfig = config.try_deserialize()?;

    if let Ok(db_url) = std::env::var("APP_DATABASE__URL") {
        app_config.database.url = db_url;
    }

    if let Ok(api_base_url) = std::env::var("APP_API__BASE_URL") {
        app_config.api.base_url = api_base_url;
    }

    if let Ok(log_level) = std::env::var("APP_LOGGING__LEVEL") {
        app_config.logging.level = log_level;
    }

    if let Ok(max_connections) = std::env::var("APP_DATABASE__MAX_CONNECTIONS") {
        if let Ok(max_conn) = max_connections.parse::<usize>() {
            app_config.database.max_connections = max_conn;
        }
    }

    if let Ok(timeout) = std::env::var("APP_API__TIMEOUT") {
        if let Ok(timeout_val) = timeout.parse::<u64>() {
            app_config.api.timeout = timeout_val;
        }
    }

    app_config
        .validate()
        .map_err(error::ConfigError::Validation)?;

    Ok(app_config)
}
