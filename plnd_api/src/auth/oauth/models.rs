use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub token_type: Option<String>,
    pub id_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthUserInfo {
    pub sub: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub picture: Option<String>,
    pub email_verified: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct OAuthProviderConfig {
    pub name: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    /// Browser-facing base URL (used to build the authorize redirect)
    pub issuer_url: Option<String>,
    /// Internal base URL for server-to-server calls (token exchange, userinfo).
    /// Use this inside Docker where `localhost` doesn't reach other containers.
    /// Falls back to `issuer_url` when not set.
    pub internal_issuer_url: Option<String>,
    pub scopes: Vec<String>,
    pub enabled: bool,
}
