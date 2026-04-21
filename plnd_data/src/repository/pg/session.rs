use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::sessions;
use crate::repository::session::SessionRepository;

pub struct PgSessionRepository {
    pool: PgPool,
}

impl PgSessionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SessionRepository for PgSessionRepository {
    async fn create(
        &self,
        user_id: Uuid,
        jti: &str,
        ip_address: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<String, DatabaseError> {
        sessions::create(&self.pool, user_id, jti, ip_address, user_agent).await
    }

    async fn validate(&self, jti: &str) -> Result<bool, DatabaseError> {
        sessions::validate(&self.pool, jti).await
    }

    async fn revoke(&self, jti: &str) -> Result<(), DatabaseError> {
        sessions::revoke(&self.pool, jti).await
    }
}
