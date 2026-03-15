use crate::auth::error::AuthError;
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct SessionService {
    pool: Option<PgPool>,
}

impl Default for SessionService {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionService {
    /// Create a stub SessionService (no DB — for unit tests)
    pub fn new() -> Self {
        Self { pool: None }
    }

    /// Create a SessionService backed by a real database pool
    pub fn with_pool(pool: PgPool) -> Self {
        Self { pool: Some(pool) }
    }

    /// Create a session record. The `jti` is the JWT ID claim stored in `token_hash`.
    /// Returns the session_id (UUID string).
    pub async fn create_session(
        &self,
        user_id: &str,
        jti: &str,
        ip_address: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<String, AuthError> {
        let session_id = Uuid::new_v4();
        let expires_at = Utc::now() + Duration::days(30);

        if let Some(pool) = &self.pool {
            let user_uuid = Uuid::parse_str(user_id)
                .map_err(|e| AuthError::SessionError(format!("Invalid user_id UUID: {}", e)))?;

            sqlx::query(
                "INSERT INTO auth_sessions
                    (session_id, user_id, token_hash, expires_at, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(session_id)
            .bind(user_uuid)
            .bind(jti)
            .bind(expires_at)
            .bind(ip_address)
            .bind(user_agent)
            .execute(pool)
            .await
            .map_err(|e| AuthError::SessionError(format!("Failed to create session: {}", e)))?;
        }

        Ok(session_id.to_string())
    }

    /// Returns true if a session with the given JTI exists, is not expired, and is not revoked.
    pub async fn validate_session(&self, jti: &str) -> Result<bool, AuthError> {
        let Some(pool) = &self.pool else {
            // Stub mode: always valid
            return Ok(true);
        };

        #[derive(sqlx::FromRow)]
        struct Row {
            is_revoked: bool,
            expires_at: DateTime<Utc>,
        }

        let row = sqlx::query_as::<_, Row>(
            "SELECT is_revoked, expires_at FROM auth_sessions WHERE token_hash = $1",
        )
        .bind(jti)
        .fetch_optional(pool)
        .await
        .map_err(|e| AuthError::SessionError(format!("Failed to validate session: {}", e)))?;

        match row {
            None => Ok(false),
            Some(r) => Ok(!r.is_revoked && r.expires_at > Utc::now()),
        }
    }

    /// Mark the session identified by JTI as revoked.
    pub async fn revoke_session(&self, jti: &str) -> Result<(), AuthError> {
        let Some(pool) = &self.pool else {
            // Stub mode: no-op
            return Ok(());
        };

        sqlx::query("UPDATE auth_sessions SET is_revoked = TRUE WHERE token_hash = $1")
            .bind(jti)
            .execute(pool)
            .await
            .map_err(|e| AuthError::SessionError(format!("Failed to revoke session: {}", e)))?;

        Ok(())
    }
}
