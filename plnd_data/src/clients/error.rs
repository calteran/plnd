use thiserror::Error;

#[derive(Error, Debug)]
pub enum ExternalClientError {
    #[error("HTTP request failed: {0}")]
    HttpError(String),
    #[error("Rate limited by provider; retry after {retry_after_secs:?} seconds")]
    RateLimited { retry_after_secs: Option<u64> },
    #[error("Unauthorized: invalid or missing API key")]
    Unauthorized,
    #[error("Resource not found at provider")]
    NotFound,
    #[error("Failed to parse provider response: {0}")]
    ResponseParseError(String),
    #[error("Client configuration error: {0}")]
    ConfigurationError(String),
}

impl From<reqwest::Error> for ExternalClientError {
    fn from(e: reqwest::Error) -> Self {
        ExternalClientError::HttpError(e.to_string())
    }
}
