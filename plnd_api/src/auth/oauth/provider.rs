use super::models::{OAuthProviderConfig, OAuthToken, OAuthUserInfo};
use crate::auth::error::AuthError;
use async_trait::async_trait;

#[async_trait]
pub trait OAuthProvider: Send + Sync {
    /// Get the authorization URL for the OAuth provider
    fn get_auth_url(&self, state: &str, redirect_uri: &str) -> String;

    /// Exchange authorization code for access token
    async fn exchange_code_for_token(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<OAuthToken, AuthError>;

    /// Get user information using the access token
    async fn get_user_info(&self, token: &OAuthToken) -> Result<OAuthUserInfo, AuthError>;

    /// Get the provider type/name
    fn get_provider_type(&self) -> &str;

    /// Check if provider is enabled
    fn is_enabled(&self) -> bool;

    /// Get the provider configuration
    fn config(&self) -> &OAuthProviderConfig;
}

pub struct BaseOAuthProvider {
    config: OAuthProviderConfig,
}

impl BaseOAuthProvider {
    pub fn new(config: OAuthProviderConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &OAuthProviderConfig {
        &self.config
    }
}
