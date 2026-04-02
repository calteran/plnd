use thiserror::Error;

#[derive(Debug, Error)]
#[allow(clippy::enum_variant_names)]
pub enum DatabaseError {
    #[error("Database connection failed: {0}")]
    ConnectionError(String),

    #[error("Database query failed: {0}")]
    QueryError(String),

    #[error("Unique constraint violation")]
    UniqueViolation,

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
        if let sqlx::Error::Database(ref db_err) = error {
            // PostgreSQL unique_violation SQLSTATE 23505
            if db_err.code().as_deref() == Some("23505") {
                return DatabaseError::UniqueViolation;
            }
        }
        DatabaseError::QueryError(error.to_string())
    }
}
