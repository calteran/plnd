use crate::auth::error::AuthError;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

const JWKS_TTL: Duration = Duration::from_secs(3600); // 1 hour

/// Claims extracted from an OIDC ID token issued by the IdP.
#[derive(Debug, Deserialize, Clone)]
pub struct IdTokenClaims {
    pub sub: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub email_verified: Option<bool>,
    /// `aud` may be a single string or a JSON array of strings.
    pub aud: serde_json::Value,
    pub iss: String,
    pub exp: usize,
    pub iat: usize,
}

#[derive(Deserialize)]
struct OidcDiscovery {
    jwks_uri: String,
}

struct CachedJwks {
    keyset: jsonwebtoken::jwk::JwkSet,
    fetched_at: Instant,
}

/// Thread-safe JWKS cache with TTL-based refresh.
///
/// Uses `internal_issuer_url` for server-to-server JWKS fetching (supports Docker
/// internal hostnames). Uses `issuer_url` to validate the `iss` claim in tokens,
/// since the IdP embeds the browser-facing URL there.
pub struct JwksCache {
    client: reqwest::Client,
    /// Used for OIDC discovery + JWKS fetch (may be Docker-internal).
    internal_issuer_url: String,
    /// Used to validate the `iss` claim in ID tokens (browser-facing URL).
    issuer_url: String,
    cache: RwLock<Option<CachedJwks>>,
}

impl JwksCache {
    pub fn new(issuer_url: String, internal_issuer_url: String) -> Arc<Self> {
        Arc::new(Self {
            client: reqwest::Client::new(),
            internal_issuer_url,
            issuer_url,
            cache: RwLock::new(None),
        })
    }

    async fn discover_jwks_uri(&self) -> Result<String, AuthError> {
        let url = format!(
            "{}/.well-known/openid-configuration",
            self.internal_issuer_url
        );
        let discovery: OidcDiscovery = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| AuthError::JwksError(format!("OIDC discovery request failed: {}", e)))?
            .json()
            .await
            .map_err(|e| {
                AuthError::JwksError(format!("Failed to parse OIDC discovery document: {}", e))
            })?;
        Ok(discovery.jwks_uri)
    }

    async fn fetch_fresh_jwks(&self) -> Result<jsonwebtoken::jwk::JwkSet, AuthError> {
        let jwks_uri = self.discover_jwks_uri().await?;
        let keyset: jsonwebtoken::jwk::JwkSet = self
            .client
            .get(&jwks_uri)
            .send()
            .await
            .map_err(|e| AuthError::JwksError(format!("JWKS fetch failed: {}", e)))?
            .json()
            .await
            .map_err(|e| AuthError::JwksError(format!("Failed to parse JWKS: {}", e)))?;
        Ok(keyset)
    }

    async fn get_jwks(&self) -> Result<jsonwebtoken::jwk::JwkSet, AuthError> {
        // Fast path: read lock, return cached keyset if still fresh.
        {
            let read = self.cache.read().await;
            if let Some(cached) = read.as_ref()
                && cached.fetched_at.elapsed() < JWKS_TTL
            {
                return Ok(cached.keyset.clone());
            }
        }

        // Slow path: acquire write lock and refresh.
        let mut write = self.cache.write().await;
        // Double-check after acquiring write lock (another thread may have refreshed).
        if let Some(cached) = write.as_ref()
            && cached.fetched_at.elapsed() < JWKS_TTL
        {
            return Ok(cached.keyset.clone());
        }

        let keyset = self.fetch_fresh_jwks().await?;
        *write = Some(CachedJwks {
            keyset: keyset.clone(),
            fetched_at: Instant::now(),
        });
        Ok(keyset)
    }

    /// Validate an RS256 ID token against the JWKS published by the IdP.
    ///
    /// Verifies the signature, expiry, and audience. Returns the extracted claims.
    pub async fn validate_id_token(
        &self,
        id_token: &str,
        expected_audience: &str,
    ) -> Result<IdTokenClaims, AuthError> {
        let header = decode_header(id_token)
            .map_err(|e| AuthError::JwksError(format!("Failed to decode token header: {}", e)))?;

        let keyset = self.get_jwks().await?;

        // Find the signing key by `kid`, falling back to the first key if absent.
        let jwk = if let Some(kid) = &header.kid {
            keyset
                .find(kid)
                .ok_or_else(|| AuthError::JwksError(format!("No JWK found for kid '{}'", kid)))?
        } else {
            keyset
                .keys
                .first()
                .ok_or_else(|| AuthError::JwksError("JWKS is empty".to_string()))?
        };

        let decoding_key = DecodingKey::from_jwk(jwk).map_err(|e| {
            AuthError::JwksError(format!("Failed to build decoding key from JWK: {}", e))
        })?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[expected_audience]);
        validation.set_issuer(&[&self.issuer_url]);

        let token_data = decode::<IdTokenClaims>(id_token, &decoding_key, &validation)
            .map_err(|e| AuthError::JwksError(format!("ID token validation failed: {}", e)))?;

        Ok(token_data.claims)
    }
}
