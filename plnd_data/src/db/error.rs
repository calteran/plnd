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

    #[error("Migration failed: {0}")]
    MigrationError(String),

    #[allow(dead_code)]
    #[error("Database configuration error: {0}")]
    ConfigurationError(String),

    #[error("Record not found")]
    NotFound,

    #[error("Database connection lost")]
    ConnectionLost,
}

impl From<sqlx::Error> for DatabaseError {
    fn from(error: sqlx::Error) -> Self {
        match &error {
            sqlx::Error::RowNotFound => DatabaseError::NotFound,
            sqlx::Error::PoolClosed | sqlx::Error::PoolTimedOut => DatabaseError::ConnectionLost,
            sqlx::Error::Io(_) => DatabaseError::ConnectionLost,
            sqlx::Error::Database(ref db_err) if db_err.code().as_deref() == Some("23505") => {
                DatabaseError::UniqueViolation
            }
            _ => DatabaseError::QueryError(error.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_not_found_maps_to_not_found() {
        let err = DatabaseError::from(sqlx::Error::RowNotFound);
        assert!(matches!(err, DatabaseError::NotFound));
    }

    #[test]
    fn pool_closed_maps_to_connection_lost() {
        let err = DatabaseError::from(sqlx::Error::PoolClosed);
        assert!(matches!(err, DatabaseError::ConnectionLost));
    }

    #[test]
    fn pool_timed_out_maps_to_connection_lost() {
        let err = DatabaseError::from(sqlx::Error::PoolTimedOut);
        assert!(matches!(err, DatabaseError::ConnectionLost));
    }

    #[test]
    fn io_error_maps_to_connection_lost() {
        let err = DatabaseError::from(sqlx::Error::Io(std::io::Error::other("network reset")));
        assert!(matches!(err, DatabaseError::ConnectionLost));
    }

    #[test]
    fn generic_error_maps_to_query_error() {
        let err = DatabaseError::from(sqlx::Error::WorkerCrashed);
        assert!(matches!(err, DatabaseError::QueryError(_)));
    }
}
