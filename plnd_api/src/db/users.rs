use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::User;

/// Find a user by their email address
pub async fn find_by_email(pool: &PgPool, email: &str) -> Result<Option<User>, DatabaseError> {
    sqlx::query_as::<_, User>(
        "SELECT user_id, email, display_name, created_at, updated_at,
                is_active, last_login, profile_picture_url
         FROM users WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}

/// Find a user by their UUID
pub async fn find_by_id(pool: &PgPool, user_id: Uuid) -> Result<Option<User>, DatabaseError> {
    sqlx::query_as::<_, User>(
        "SELECT user_id, email, display_name, created_at, updated_at,
                is_active, last_login, profile_picture_url
         FROM users WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}

/// Create a new user, returning the created record
pub async fn create(
    pool: &PgPool,
    email: &str,
    display_name: Option<&str>,
    profile_picture_url: Option<&str>,
) -> Result<User, DatabaseError> {
    let now = Utc::now();
    let user_id = Uuid::new_v4();

    sqlx::query_as::<_, User>(
        "INSERT INTO users (user_id, email, display_name, created_at, updated_at,
                            is_active, profile_picture_url)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)
         RETURNING user_id, email, display_name, created_at, updated_at,
                   is_active, last_login, profile_picture_url",
    )
    .bind(user_id)
    .bind(email)
    .bind(display_name)
    .bind(now)
    .bind(now)
    .bind(profile_picture_url)
    .fetch_one(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}

/// Find a user by their OAuth provider type and provider-issued user ID (sub)
pub async fn find_by_provider(
    pool: &PgPool,
    provider_type: &str,
    provider_user_id: &str,
) -> Result<Option<User>, DatabaseError> {
    sqlx::query_as::<_, User>(
        "SELECT u.user_id, u.email, u.display_name, u.created_at, u.updated_at,
                u.is_active, u.last_login, u.profile_picture_url
         FROM users u
         JOIN oauth_providers op ON op.user_id = u.user_id
         WHERE op.provider_type = $1 AND op.provider_user_id = $2",
    )
    .bind(provider_type)
    .bind(provider_user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}

/// Record an OAuth provider link for an existing user
pub async fn link_oauth_provider(
    pool: &PgPool,
    user_id: Uuid,
    provider_type: &str,
    provider_user_id: &str,
) -> Result<(), DatabaseError> {
    sqlx::query(
        "INSERT INTO oauth_providers (provider_id, user_id, provider_type, provider_user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, provider_type) DO UPDATE
           SET provider_user_id = EXCLUDED.provider_user_id",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(provider_type)
    .bind(provider_user_id)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}

/// Update a user's display_name and/or profile_picture_url.
/// Fields set to None are left unchanged (COALESCE semantics).
pub async fn update_profile(
    pool: &PgPool,
    user_id: Uuid,
    display_name: Option<&str>,
    profile_picture_url: Option<&str>,
) -> Result<Option<User>, DatabaseError> {
    sqlx::query_as::<_, User>(
        "UPDATE users
         SET display_name = COALESCE($2, display_name),
             profile_picture_url = COALESCE($3, profile_picture_url),
             updated_at = NOW()
         WHERE user_id = $1
         RETURNING user_id, email, display_name, created_at, updated_at,
                   is_active, last_login, profile_picture_url",
    )
    .bind(user_id)
    .bind(display_name)
    .bind(profile_picture_url)
    .fetch_optional(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}

/// Soft-deactivate a user (is_active = FALSE). Returns true if a row was updated.
pub async fn deactivate_user(pool: &PgPool, user_id: Uuid) -> Result<bool, DatabaseError> {
    sqlx::query("UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .map_err(|e| DatabaseError::QueryError(e.to_string()))
}

/// Update a user's last_login timestamp
pub async fn touch_last_login(pool: &PgPool, user_id: Uuid) -> Result<(), DatabaseError> {
    sqlx::query("UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| DatabaseError::QueryError(e.to_string()))
}
