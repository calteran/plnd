use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct DatabaseConfig {
    pub url: String,
    #[serde(default = "default_max_connections")]
    pub max_connections: usize,
}

fn default_max_connections() -> usize {
    10
}

#[derive(Debug, Deserialize, Clone)]
pub struct ApiConfig {
    pub base_url: String,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

fn default_timeout() -> u64 {
    30000
}

#[derive(Debug, Deserialize, Clone, Default)]
#[allow(dead_code)] // pretty_print field is for future use
pub struct LoggingConfig {
    #[serde(default = "default_log_level")]
    pub level: String,
    #[serde(default = "default_pretty_print")]
    pub pretty_print: bool,
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_pretty_print() -> bool {
    true
}

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub api: ApiConfig,
    pub database: DatabaseConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
}

impl AppConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.api.timeout == 0 {
            return Err("API timeout must be greater than 0".to_string());
        }

        if self.database.max_connections == 0 {
            return Err("Database max_connections must be greater than 0".to_string());
        }

        if !["debug", "info", "warn", "error"].contains(&self.logging.level.as_str()) {
            return Err(format!("Invalid log level: {}", self.logging.level));
        }

        Ok(())
    }
}
