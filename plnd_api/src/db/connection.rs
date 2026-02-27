use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

use crate::db::error::DatabaseError;

#[derive(Clone)]
pub struct Database {
    pool: PgPool,
}

impl Database {
    /// Create a new database connection pool
    pub async fn new(database_url: &str) -> Result<Self, DatabaseError> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .acquire_timeout(Duration::from_secs(30))
            .idle_timeout(Duration::from_secs(600))
            .connect(database_url)
            .await
            .map_err(|e| DatabaseError::ConnectionError(e.to_string()))?;

        Ok(Database { pool })
    }

    /// Get a reference to the connection pool
    #[allow(dead_code)]
    pub fn get_pool(&self) -> &PgPool {
        &self.pool
    }

    /// Health check - verify database connectivity
    pub async fn health_check(&self) -> Result<(), DatabaseError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|e| DatabaseError::QueryError(e.to_string()))
    }
}
