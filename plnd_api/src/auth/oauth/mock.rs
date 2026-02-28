use super::{
    provider::BaseOAuthProvider, OAuthProvider, OAuthProviderConfig, OAuthToken, OAuthUserInfo,
};
use crate::auth::error::AuthError;
use async_trait::async_trait;
use reqwest::Client;

pub struct MockOAuthProvider {
    base: BaseOAuthProvider,
    client: Client,
}

impl MockOAuthProvider {
    pub fn new(config: OAuthProviderConfig) -> Self {
        Self {
            base: BaseOAuthProvider::new(config),
            client: Client::new(),
        }
    }

    fn get_issuer_url(&self) -> Result<String, AuthError> {
        self.base.config().issuer_url.clone().ok_or_else(|| {
            AuthError::ConfigurationError("Mock provider requires issuer_url".to_string())
        })
    }
}

#[async_trait]
impl OAuthProvider for MockOAuthProvider {
    fn get_auth_url(&self, state: &str, redirect_uri: &str) -> String {
        let issuer_url = self
            .get_issuer_url()
            .unwrap_or_else(|_| "http://localhost:8080".to_string());
        format!(
            "{}/authorize?response_type=code&client_id={}&redirect_uri={}&state={}&scope={}",
            issuer_url,
            self.base.config().client_id,
            redirect_uri,
            state,
            self.base.config().scopes.join(" ")
        )
    }

    async fn exchange_code_for_token(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<OAuthToken, AuthError> {
        let issuer_url = self.get_issuer_url()?;

        let response = self
            .client
            .post(format!("{}/token", issuer_url))
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", redirect_uri),
                ("client_id", &self.base.config().client_id),
                ("client_secret", &self.base.config().client_secret),
            ])
            .send()
            .await
            .map_err(|e| AuthError::OAuthProviderError(format!("Token exchange failed: {}", e)))?;

        let token_response: serde_json::Value = response.json().await.map_err(|e| {
            AuthError::OAuthProviderError(format!("Failed to parse token response: {}", e))
        })?;

        Ok(OAuthToken {
            access_token: token_response["access_token"]
                .as_str()
                .ok_or_else(|| AuthError::OAuthProviderError("Missing access_token".to_string()))?
                .to_string(),
            refresh_token: token_response["refresh_token"]
                .as_str()
                .map(|s: &str| s.to_string()),
            expires_in: token_response["expires_in"].as_u64(),
            token_type: token_response["token_type"]
                .as_str()
                .map(|s: &str| s.to_string()),
            id_token: token_response["id_token"]
                .as_str()
                .map(|s: &str| s.to_string()),
        })
    }

    async fn get_user_info(&self, token: &OAuthToken) -> Result<OAuthUserInfo, AuthError> {
        let issuer_url = self.get_issuer_url()?;

        let response = self
            .client
            .get(format!("{}/userinfo", issuer_url))
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|e| {
                AuthError::OAuthProviderError(format!("User info request failed: {}", e))
            })?;

        let user_info: serde_json::Value = response.json().await.map_err(|e| {
            AuthError::OAuthProviderError(format!("Failed to parse user info: {}", e))
        })?;

        Ok(OAuthUserInfo {
            sub: user_info["sub"]
                .as_str()
                .ok_or_else(|| AuthError::OAuthProviderError("Missing sub field".to_string()))?
                .to_string(),
            email: user_info["email"].as_str().map(|s: &str| s.to_string()),
            name: user_info["name"].as_str().map(|s: &str| s.to_string()),
            given_name: user_info["given_name"]
                .as_str()
                .map(|s: &str| s.to_string()),
            family_name: user_info["family_name"]
                .as_str()
                .map(|s: &str| s.to_string()),
            picture: user_info["picture"].as_str().map(|s: &str| s.to_string()),
            email_verified: user_info["email_verified"].as_bool(),
        })
    }

    fn get_provider_type(&self) -> &str {
        "mock"
    }

    fn is_enabled(&self) -> bool {
        self.base.config().enabled
    }

    fn config(&self) -> &OAuthProviderConfig {
        self.base.config()
    }
}
