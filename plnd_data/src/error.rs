use thiserror::Error;

use crate::db::error::DatabaseError;

#[derive(Debug, Error)]
pub enum Error {
    #[error("Record not found")]
    NotFound,

    #[error("Unique constraint violation")]
    Conflict,

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Database connection failed: {0}")]
    Connection(String),

    #[error("Database connection lost")]
    ConnectionLost,

    #[error("Migration failed: {0}")]
    Migration(String),

    #[error("Database configuration error: {0}")]
    Configuration(String),

    #[error("Database query failed: {0}")]
    Query(String),
}

impl From<DatabaseError> for Error {
    fn from(e: DatabaseError) -> Self {
        match e {
            DatabaseError::NotFound => Error::NotFound,
            DatabaseError::UniqueViolation => Error::Conflict,
            DatabaseError::ConnectionError(s) => Error::Connection(s),
            DatabaseError::ConnectionLost => Error::ConnectionLost,
            DatabaseError::MigrationError(s) => Error::Migration(s),
            DatabaseError::ConfigurationError(s) => Error::Configuration(s),
            DatabaseError::QueryError(s) => Error::Query(s),
            DatabaseError::Validation(s) => Error::Validation(s),
        }
    }
}
