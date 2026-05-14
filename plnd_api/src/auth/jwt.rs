use crate::auth::error::AuthError;
use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use veil::Redact;

#[derive(Redact, Serialize, Deserialize, Clone)]
#[redact(all)]
pub struct Claims {
    #[redact(skip)]
    pub sub: String, // Subject (user ID)
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
    #[redact(skip)]
    pub exp: usize, // Expiration time
    #[redact(skip)]
    pub iat: usize, // Issued at
    #[redact(skip)]
    pub jti: String, // JWT ID
}

#[derive(Clone)]
pub struct JwtService {
    secret: String,
    expiration: u64,
}

impl JwtService {
    pub fn new(secret: String, expiration: u64) -> Self {
        Self { secret, expiration }
    }

    pub fn generate_token(
        &self,
        user_id: &str,
        email: &str,
        name: Option<&str>,
        picture: Option<&str>,
    ) -> Result<String, AuthError> {
        let now = Utc::now();
        let iat = now.timestamp() as usize;
        let exp = (now + Duration::seconds(self.expiration as i64)).timestamp() as usize;

        let claims = Claims {
            sub: user_id.to_string(),
            email: email.to_string(),
            name: name.map(|s| s.to_string()),
            picture: picture.map(|s| s.to_string()),
            exp,
            iat,
            jti: Uuid::new_v4().to_string(),
        };

        let header = Header::new(Algorithm::HS256);

        encode(
            &header,
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
        .map_err(|e| AuthError::JwtError(format!("Failed to generate token: {}", e)))
    }

    pub fn validate_token(&self, token: &str) -> Result<Claims, AuthError> {
        let decoding_key = DecodingKey::from_secret(self.secret.as_bytes());

        decode::<Claims>(token, &decoding_key, &Validation::new(Algorithm::HS256))
            .map(|token_data| token_data.claims)
            .map_err(|e| AuthError::JwtError(format!("Invalid token: {}", e)))
    }

    pub fn generate_refresh_token(&self) -> String {
        Uuid::new_v4().to_string()
    }

    /// Returns the configured token lifetime in seconds.
    pub fn expiration(&self) -> u64 {
        self.expiration
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_debug_redacts_pii() {
        let claims = Claims {
            sub: "user-uuid-12345".to_string(),
            email: "secret@example.com".to_string(),
            name: Some("Jane Doe".to_string()),
            picture: Some("https://example.com/photo.jpg".to_string()),
            exp: 1234567890,
            iat: 1234560000,
            jti: "jwt-id-abc".to_string(),
        };
        let debug = format!("{:?}", claims);

        assert!(
            !debug.contains("secret@example.com"),
            "email leaked: {debug}"
        );
        assert!(!debug.contains("Jane Doe"), "name leaked: {debug}");
        assert!(!debug.contains("photo.jpg"), "picture leaked: {debug}");

        assert!(debug.contains("user-uuid-12345"), "sub missing: {debug}");
        assert!(debug.contains("jwt-id-abc"), "jti missing: {debug}");
    }
}
