use crate::auth::JwtService;
use axum::body::Body;
use axum::http::StatusCode;
use axum::{http::Request, middleware::Next, response::Response};

pub async fn auth_middleware(request: Request<Body>, next: Next) -> Result<Response, StatusCode> {
    // Get JWT service from request extensions
    let jwt_service = request
        .extensions()
        .get::<JwtService>()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    // Extract token from Authorization header
    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|header| header.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Validate token
    match jwt_service.validate_token(token) {
        Ok(claims) => {
            // Add claims to request extensions for downstream handlers
            let mut request = request;
            request.extensions_mut().insert(claims);
            Ok(next.run(request).await)
        }
        Err(_) => Err(StatusCode::UNAUTHORIZED),
    }
}
