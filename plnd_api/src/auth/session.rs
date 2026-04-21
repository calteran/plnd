use std::sync::Arc;

use crate::auth::error::AuthError;
use async_trait::async_trait;
use plnd_data::repository::SessionRepository;
use plnd_data::DatabaseError;
use uuid::Uuid;

#[derive(Clone)]
pub struct SessionService {
    session_repo: Arc<dyn SessionRepository>,
}

impl SessionService {
    /// Create a SessionService backed by the given repository.
    pub fn with_repo(session_repo: Arc<dyn SessionRepository>) -> Self {
        Self { session_repo }
    }

    /// Create a stub SessionService for use in tests (no database).
    ///
    /// Production code uses `with_repo()`; this constructor exists solely for
    /// offline unit and integration tests that do not need a live database.
    pub fn new() -> Self {
        Self {
            session_repo: Arc::new(StubSessionRepository),
        }
    }

    /// Create a session record. Returns the session_id (UUID string).
    pub async fn create_session(
        &self,
        user_id: &str,
        jti: &str,
        ip_address: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<String, AuthError> {
        let user_uuid = Uuid::parse_str(user_id)
            .map_err(|e| AuthError::SessionError(format!("Invalid user_id UUID: {}", e)))?;

        self.session_repo
            .create(user_uuid, jti, ip_address, user_agent)
            .await
            .map_err(|e| AuthError::SessionError(format!("Failed to create session: {}", e)))
    }

    /// Returns true if the session exists, is not expired, and is not revoked.
    pub async fn validate_session(&self, jti: &str) -> Result<bool, AuthError> {
        self.session_repo
            .validate(jti)
            .await
            .map_err(|e| AuthError::SessionError(format!("Failed to validate session: {}", e)))
    }

    /// Mark the session identified by JTI as revoked.
    pub async fn revoke_session(&self, jti: &str) -> Result<(), AuthError> {
        self.session_repo
            .revoke(jti)
            .await
            .map_err(|e| AuthError::SessionError(format!("Failed to revoke session: {}", e)))
    }
}

impl Default for SessionService {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Stub repository — used by SessionService::new() in tests
// ---------------------------------------------------------------------------

struct StubSessionRepository;

#[async_trait]
impl SessionRepository for StubSessionRepository {
    async fn create(
        &self,
        _user_id: Uuid,
        _jti: &str,
        _ip_address: Option<&str>,
        _user_agent: Option<&str>,
    ) -> Result<String, DatabaseError> {
        Ok(Uuid::new_v4().to_string())
    }

    async fn validate(&self, _jti: &str) -> Result<bool, DatabaseError> {
        Ok(true)
    }

    async fn revoke(&self, _jti: &str) -> Result<(), DatabaseError> {
        Ok(())
    }
}
