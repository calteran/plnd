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

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
pub struct OAuthProviderConfig {
    pub name: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    #[serde(default)]
    pub issuer_url: Option<String>,
    pub scopes: Vec<String>,
    #[serde(default = "default_provider_enabled")]
    pub enabled: bool,
}

fn default_provider_enabled() -> bool {
    false
}

#[derive(Debug, Deserialize, Clone, Default)]
#[allow(dead_code)]
pub struct AuthConfig {
    #[serde(default)]
    pub jwt: JwtConfig,
    #[serde(default)]
    pub oauth_providers: Vec<OAuthProviderConfig>,
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

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub api: ApiConfig,
    pub database: DatabaseConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
    #[serde(default)]
    pub auth: AuthConfig,
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
