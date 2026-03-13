use thiserror::Error;

#[derive(Debug, Error)]
pub enum SeedError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("provider error: {0}")]
    ProviderError(String),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}
