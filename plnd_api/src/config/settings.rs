use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct DatabaseConfig {
    pub url: String,
    #[serde(default = "default_max_connections")]
    pub max_connections: usize,
}

fn default_max_connections() -> usize {
    10
}

#[derive(Debug, Deserialize, Clone)]
pub struct ApiConfig {
    pub base_url: String,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

fn default_timeout() -> u64 {
    30000
}

#[derive(Debug, Deserialize, Clone, Default)]
#[allow(dead_code)] // pretty_print field is for future use
pub struct LoggingConfig {
    #[serde(default = "default_log_level")]
    pub level: String,
    #[serde(default = "default_pretty_print")]
    pub pretty_print: bool,
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_pretty_print() -> bool {
    true
}

#[derive(Debug, Deserialize, Clone)]
pub struct JwtConfig {
    pub secret: String,
    #[serde(default = "default_jwt_expiration")]
    pub jwt_expiration: u64,
    #[serde(default = "default_refresh_token_expiration")]
    pub refresh_token_expiration: u64,
}

fn default_jwt_expiration() -> u64 {
    86400 // 24 hours
}

fn default_refresh_token_expiration() -> u64 {
    604800 // 7 days
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct OidcConfig {
    /// Browser-facing OIDC issuer URL (embedded in the token's `iss` claim by the IdP).
    #[serde(default)]
    pub issuer_url: String,
    /// Internal issuer URL for server-to-server JWKS fetching (e.g. Docker-internal hostname).
    /// Falls back to `issuer_url` if empty.
    #[serde(default)]
    pub internal_issuer_url: String,
    /// OIDC client ID registered with the IdP.
    #[serde(default)]
    pub client_id: String,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[allow(dead_code)]
pub struct AuthConfig {
    #[serde(default)]
    pub jwt: JwtConfig,
    #[serde(default)]
    pub oidc: OidcConfig,
    /// Allowed CORS origin for the Angular frontend.
    #[serde(default = "default_frontend_origin")]
    pub frontend_origin: String,
}

fn default_frontend_origin() -> String {
    "http://localhost:4200".to_string()
}

impl Default for JwtConfig {
    fn default() -> Self {
        Self {
            secret: "development-secret".to_string(),
            jwt_expiration: default_jwt_expiration(),
            refresh_token_expiration: default_refresh_token_expiration(),
        }
    }
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct ExternalProvidersConfig {
    #[serde(default)]
    pub usda_fdc_api_key: String,
    #[serde(default = "default_themealdb_key")]
    pub themealdb_api_key: String,
    #[serde(default = "default_cache_ttl_hours")]
    pub search_cache_ttl_hours: u64,
    /// Base URL for Open Food Facts requests. Use the staging server during development.
    #[serde(default = "default_off_base_url")]
    pub off_base_url: String,
    /// Basic-auth username for the OFf staging server (`off`). Leave empty for production.
    #[serde(default)]
    pub off_basic_auth_user: String,
    /// Basic-auth password for the OFf staging server (`off`). Leave empty for production.
    #[serde(default)]
    pub off_basic_auth_password: String,
    /// RSS/Atom feed URL for briefing headlines. Leave empty to disable news.
    #[serde(default)]
    pub news_feed_url: String,
}

fn default_themealdb_key() -> String {
    "1".to_string()
}

fn default_off_base_url() -> String {
    "https://world.openfoodfacts.net".to_string()
}

fn default_cache_ttl_hours() -> u64 {
    36
}

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub api: ApiConfig,
    pub database: DatabaseConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub external_providers: ExternalProvidersConfig,
    #[serde(default)]
    pub llm: plnd_agent::LlmConfig,
}

impl AppConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.api.timeout == 0 {
            return Err("API timeout must be greater than 0".to_string());
        }

        if self.database.max_connections == 0 {
            return Err("Database max_connections must be greater than 0".to_string());
        }

        if !["debug", "info", "warn", "error"].contains(&self.logging.level.as_str()) {
            return Err(format!("Invalid log level: {}", self.logging.level));
        }

        if self.auth.jwt.secret.is_empty() {
            return Err("JWT secret cannot be empty".to_string());
        }

        if self.auth.jwt.jwt_expiration == 0 {
            return Err("JWT expiration must be greater than 0".to_string());
        }

        if self.auth.jwt.refresh_token_expiration == 0 {
            return Err("Refresh token expiration must be greater than 0".to_string());
        }

        Ok(())
    }
}
