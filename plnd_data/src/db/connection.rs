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
    pub async fn new(database_url: &str, max_connections: u32) -> Result<Self, DatabaseError> {
        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .acquire_timeout(Duration::from_secs(30))
            .idle_timeout(Duration::from_secs(600))
            .connect(database_url)
            .await
            .map_err(|e| DatabaseError::ConnectionError(e.to_string()))?;

        Ok(Database { pool })
    }

    pub(crate) fn get_pool(&self) -> &PgPool {
        &self.pool
    }

    /// Health check - verify database connectivity
    #[tracing::instrument(skip_all)]
    pub async fn health_check(&self) -> Result<(), DatabaseError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(DatabaseError::from)
    }
}

/// Run all pending database migrations.
pub(crate) async fn run_migrations(pool: &sqlx::PgPool) -> Result<(), DatabaseError> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .map_err(|e| DatabaseError::MigrationError(e.to_string()))
}
