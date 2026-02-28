use crate::auth::error::AuthError;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String, // Subject (user ID)
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub exp: usize,  // Expiration time
    pub iat: usize,  // Issued at
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
}
