use crate::auth::error::AuthError;
use plnd_data::db::Database;
use uuid::Uuid;

#[derive(Clone)]
pub struct SessionService {
    db: Option<Database>,
}

impl Default for SessionService {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionService {
    /// Create a stub SessionService (no DB — for unit tests)
    pub fn new() -> Self {
        Self { db: None }
    }

    /// Create a SessionService backed by a real database
    pub fn with_db(db: Database) -> Self {
        Self { db: Some(db) }
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
        if let Some(db) = &self.db {
            let user_uuid = Uuid::parse_str(user_id)
                .map_err(|e| AuthError::SessionError(format!("Invalid user_id UUID: {}", e)))?;

            return plnd_data::db::sessions::create(
                db.get_pool(),
                user_uuid,
                jti,
                ip_address,
                user_agent,
            )
            .await
            .map_err(|e| AuthError::SessionError(format!("Failed to create session: {}", e)));
        }

        Ok(Uuid::new_v4().to_string())
    }

    /// Returns true if a session with the given JTI exists, is not expired, and is not revoked.
    pub async fn validate_session(&self, jti: &str) -> Result<bool, AuthError> {
        let Some(db) = &self.db else {
            // Stub mode: always valid
            return Ok(true);
        };

        plnd_data::db::sessions::validate(db.get_pool(), jti)
            .await
            .map_err(|e| AuthError::SessionError(format!("Failed to validate session: {}", e)))
    }

    /// Mark the session identified by JTI as revoked.
    pub async fn revoke_session(&self, jti: &str) -> Result<(), AuthError> {
        let Some(db) = &self.db else {
            // Stub mode: no-op
            return Ok(());
        };

        plnd_data::db::sessions::revoke(db.get_pool(), jti)
            .await
            .map_err(|e| AuthError::SessionError(format!("Failed to revoke session: {}", e)))
    }
}
