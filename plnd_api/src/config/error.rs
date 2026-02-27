use thiserror::Error;

#[derive(Error, Debug)]
#[allow(dead_code)] // FileNotFound variant is for future use
pub enum ConfigError {
    #[error("Configuration file not found: {0}")]
    FileNotFound(String),

    #[error("Configuration error: {0}")]
    Config(#[from] config::ConfigError),

    #[error("Environment variable error: {0}")]
    EnvVar(#[from] std::env::VarError),

    #[error("Validation error: {0}")]
    Validation(String),
}
