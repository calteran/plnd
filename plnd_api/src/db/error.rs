use thiserror::Error;

#[derive(Debug, Error)]
#[allow(clippy::enum_variant_names)]
pub enum DatabaseError {
    #[error("Database connection failed: {0}")]
    ConnectionError(String),

    #[error("Database query failed: {0}")]
    QueryError(String),

    #[error("Validation error: {0}")]
    ValidationError(String),

    #[allow(dead_code)]
    #[error("Migration failed: {0}")]
    MigrationError(String),

    #[allow(dead_code)]
    #[error("Database configuration error: {0}")]
    ConfigurationError(String),
}

impl From<sqlx::Error> for DatabaseError {
    fn from(error: sqlx::Error) -> Self {
        DatabaseError::ConnectionError(error.to_string())
    }
}
