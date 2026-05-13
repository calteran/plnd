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
        .add_source(File::with_name(&format!("{}{}", path, "../config/api/default")).required(true))
        // Load environment-specific configuration (optional)
        .add_source(
            File::with_name(&format!("{}{}", path, "../config/api/development")).required(false),
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

    if let Ok(max_connections) = std::env::var("APP_DATABASE__MAX_CONNECTIONS")
        && let Ok(max_conn) = max_connections.parse::<usize>()
    {
        app_config.database.max_connections = max_conn;
    }

    if let Ok(timeout) = std::env::var("APP_API__TIMEOUT")
        && let Ok(timeout_val) = timeout.parse::<u64>()
    {
        app_config.api.timeout = timeout_val;
    }

    if let Ok(url) = std::env::var("APP_AUTH__OIDC_INTERNAL_ISSUER_URL") {
        app_config.auth.oidc.internal_issuer_url = url;
    }

    if let Ok(origin) = std::env::var("APP_AUTH__FRONTEND_ORIGIN") {
        app_config.auth.frontend_origin = origin;
    }

    if let Ok(key) = std::env::var("APP_EXTERNAL__USDA_FDC_API_KEY") {
        app_config.external_providers.usda_fdc_api_key = key;
    }

    if let Ok(secret) = std::env::var("APP_AUTH__JWT_SECRET") {
        app_config.auth.jwt.secret = secret;
    }

    if let Ok(key) = std::env::var("APP_EXTERNAL__THEMEALDB_API_KEY") {
        app_config.external_providers.themealdb_api_key = key;
    }

    if let Ok(v) = std::env::var("APP_EXTERNAL__FIXTURE_PATH") {
        app_config.external_providers.fixture_path = if v.is_empty() {
            None
        } else {
            Some(std::path::PathBuf::from(v))
        };
    }

    if let Ok(v) = std::env::var("APP_LLM__FAST__PROVIDER") {
        app_config.llm.fast.provider = v;
    }

    if let Ok(v) = std::env::var("APP_LLM__FAST__BASE_URL") {
        app_config.llm.fast.base_url = v;
    }

    if let Ok(v) = std::env::var("APP_LLM__FAST__MODEL") {
        app_config.llm.fast.model = v;
    }

    if let Ok(key) = std::env::var("APP_LLM__FAST__API_KEY") {
        app_config.llm.fast.api_key = key;
    }

    if let Ok(v) = std::env::var("APP_LLM__CAPABLE__PROVIDER") {
        app_config.llm.capable.provider = v;
    }

    if let Ok(v) = std::env::var("APP_LLM__CAPABLE__BASE_URL") {
        app_config.llm.capable.base_url = v;
    }

    if let Ok(v) = std::env::var("APP_LLM__CAPABLE__MODEL") {
        app_config.llm.capable.model = v;
    }

    if let Ok(key) = std::env::var("APP_LLM__CAPABLE__API_KEY") {
        app_config.llm.capable.api_key = key;
    }

    if let Ok(v) = std::env::var("APP_AGENT__RATE_LIMIT_PER_MINUTE")
        && let Ok(limit) = v.parse::<u32>()
    {
        app_config.agent.rate_limit_per_minute = limit;
    }

    if let Ok(v) = std::env::var("APP_AGENT__MEAL_PLAN_CONCURRENCY")
        && let Ok(limit) = v.parse::<usize>()
    {
        app_config.agent.meal_plan_concurrency = limit;
    }

    if let Ok(v) = std::env::var("APP_OTEL__ENDPOINT") {
        app_config.otel.endpoint = if v.is_empty() { None } else { Some(v) };
    }

    app_config
        .validate()
        .map_err(error::ConfigError::Validation)?;

    Ok(app_config)
}
