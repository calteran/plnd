pub mod error;
pub mod settings;

use config::{Config, Environment, File};
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
        .add_source(File::with_name(&format!("{}config/api/default", path)).required(true))
        // Load environment-specific configuration (optional)
        .add_source(File::with_name(&format!("{}config/api/development", path)).required(false))
        // Load environment variables with APP_ prefix
        .add_source(Environment::with_prefix("APP").separator("__"));

    let config = builder.build()?;

    let app_config: AppConfig = config.try_deserialize()?;
    app_config
        .validate()
        .map_err(error::ConfigError::Validation)?;

    Ok(app_config)
}
