use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;

/// Insert a new session record. Returns the session_id as a UUID string.
#[tracing::instrument(skip(pool), fields(table = "sessions", op = "create"))]
pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    jti: &str,
    ip_address: Option<&str>,
    user_agent: Option<&str>,
) -> Result<String, DatabaseError> {
    let session_id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::days(30);

    sqlx::query(
        "INSERT INTO auth_sessions
            (session_id, user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(session_id)
    .bind(user_id)
    .bind(jti)
    .bind(expires_at)
    .bind(ip_address)
    .bind(user_agent)
    .execute(pool)
    .await?;

    Ok(session_id.to_string())
}

/// Returns true if the session identified by JTI exists, is not expired, and is not revoked.
#[tracing::instrument(skip(pool), fields(table = "sessions", op = "validate"))]
pub async fn validate(pool: &PgPool, jti: &str) -> Result<bool, DatabaseError> {
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
    .await?;

    match row {
        None => Ok(false),
        Some(r) => Ok(!r.is_revoked && r.expires_at > Utc::now()),
    }
}

/// Mark the session identified by JTI as revoked.
#[tracing::instrument(skip(pool), fields(table = "sessions", op = "revoke"))]
pub async fn revoke(pool: &PgPool, jti: &str) -> Result<(), DatabaseError> {
    sqlx::query("UPDATE auth_sessions SET is_revoked = TRUE WHERE token_hash = $1")
        .bind(jti)
        .execute(pool)
        .await?;

    Ok(())
}
