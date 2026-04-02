use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::User;

/// Find a user by their email address
#[tracing::instrument(skip(pool), fields(table = "users", op = "find_by_email"))]
pub async fn find_by_email(pool: &PgPool, email: &str) -> Result<Option<User>, DatabaseError> {
    sqlx::query_as::<_, User>(
        "SELECT user_id, email, display_name, created_at, updated_at,
                is_active, last_login, avatar_url, onboarding_completed
         FROM users WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Find a user by their UUID
#[tracing::instrument(skip(pool), fields(table = "users", op = "find_by_id"))]
pub async fn find_by_id(pool: &PgPool, user_id: Uuid) -> Result<Option<User>, DatabaseError> {
    sqlx::query_as::<_, User>(
        "SELECT user_id, email, display_name, created_at, updated_at,
                is_active, last_login, avatar_url, onboarding_completed
         FROM users WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Create a new user, returning the created record
#[tracing::instrument(skip(pool), fields(table = "users", op = "create"))]
pub async fn create(
    pool: &PgPool,
    email: &str,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<User, DatabaseError> {
    let now = Utc::now();
    let user_id = Uuid::new_v4();

    sqlx::query_as::<_, User>(
        "INSERT INTO users (user_id, email, display_name, created_at, updated_at,
                            is_active, avatar_url)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)
         RETURNING user_id, email, display_name, created_at, updated_at,
                   is_active, last_login, avatar_url, onboarding_completed",
    )
    .bind(user_id)
    .bind(email)
    .bind(display_name)
    .bind(now)
    .bind(now)
    .bind(avatar_url)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Find a user by their OAuth provider type and provider-issued user ID (sub)
#[tracing::instrument(skip(pool), fields(table = "users", op = "find_by_provider"))]
pub async fn find_by_provider(
    pool: &PgPool,
    provider_type: &str,
    provider_user_id: &str,
) -> Result<Option<User>, DatabaseError> {
    sqlx::query_as::<_, User>(
        "SELECT u.user_id, u.email, u.display_name, u.created_at, u.updated_at,
                u.is_active, u.last_login, u.avatar_url, u.onboarding_completed
         FROM users u
         JOIN oauth_providers op ON op.user_id = u.user_id
         WHERE op.provider_type = $1 AND op.provider_user_id = $2",
    )
    .bind(provider_type)
    .bind(provider_user_id)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Record an OAuth provider link for an existing user
#[tracing::instrument(
    skip(pool),
    fields(table = "oauth_providers", op = "link_oauth_provider")
)]
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
    .map_err(DatabaseError::from)
}

/// Update a user's display_name and/or avatar_url.
/// Fields set to None are left unchanged (COALESCE semantics).
#[tracing::instrument(skip(pool), fields(table = "users", op = "update_profile"))]
pub async fn update_profile(
    pool: &PgPool,
    user_id: Uuid,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<Option<User>, DatabaseError> {
    sqlx::query_as::<_, User>(
        "UPDATE users
         SET display_name = COALESCE($2, display_name),
             avatar_url = COALESCE($3, avatar_url),
             updated_at = NOW()
         WHERE user_id = $1
         RETURNING user_id, email, display_name, created_at, updated_at,
                   is_active, last_login, avatar_url, onboarding_completed",
    )
    .bind(user_id)
    .bind(display_name)
    .bind(avatar_url)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Soft-deactivate a user (is_active = FALSE). Returns true if a row was updated.
#[tracing::instrument(skip(pool), fields(table = "users", op = "deactivate_user"))]
pub async fn deactivate_user(pool: &PgPool, user_id: Uuid) -> Result<bool, DatabaseError> {
    sqlx::query("UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .map(|r| r.rows_affected() > 0)
        .map_err(DatabaseError::from)
}

/// Update a user's last_login timestamp
#[tracing::instrument(skip(pool), fields(table = "users", op = "touch_last_login"))]
pub async fn touch_last_login(pool: &PgPool, user_id: Uuid) -> Result<(), DatabaseError> {
    sqlx::query("UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(DatabaseError::from)
}

/// Mark onboarding as completed for the given user.
/// The AND clause makes this idempotent — already-completed users return false but no error.
#[tracing::instrument(skip(pool), fields(table = "users", op = "complete_onboarding"))]
pub async fn complete_onboarding(pool: &PgPool, user_id: Uuid) -> Result<bool, DatabaseError> {
    sqlx::query(
        "UPDATE users SET onboarding_completed = TRUE, updated_at = NOW()
         WHERE user_id = $1 AND onboarding_completed = FALSE",
    )
    .bind(user_id)
    .execute(pool)
    .await
    .map(|r| r.rows_affected() > 0)
    .map_err(DatabaseError::from)
}
