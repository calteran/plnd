use thiserror::Error;

#[derive(Error, Debug)]
pub enum AuthError {
    #[error("OAuth provider error: {0}")]
    OAuthProviderError(String),

    #[error("JWT error: {0}")]
    JwtError(String),

    #[error("Session error: {0}")]
    SessionError(String),

    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("Configuration error: {0}")]
    ConfigurationError(String),

    #[error("Invalid credentials")]
    InvalidCredentials,

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Provider not found: {0}")]
    ProviderNotFound(String),

    #[error("Provider disabled: {0}")]
    ProviderDisabled(String),

    #[error("JWKS error: {0}")]
    JwksError(String),
}
