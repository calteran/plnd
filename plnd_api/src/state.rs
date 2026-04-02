use crate::auth::{JwksCache, JwtService, SessionService};
use crate::briefing::BriefingState;
use governor::DefaultKeyedRateLimiter;
use plnd_data::db::Database;
use plnd_data::search::ProviderSearchService;
use std::sync::Arc;

/// Shared application state available to all route handlers
#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub jwt: JwtService,
    pub session: SessionService,
    /// JWKS cache for validating RS256 ID tokens from the configured IdP.
    pub jwks: Arc<JwksCache>,
    /// OIDC client_id used as the expected `aud` claim in ID tokens.
    pub oidc_client_id: String,
    pub provider_search: ProviderSearchService,
    pub briefing: BriefingState,
    /// Per-IP rate limiter for unauthenticated POST /api/client_error requests.
    /// Authenticated requests (valid JWT) bypass this limiter entirely.
    pub client_error_limiter: Arc<DefaultKeyedRateLimiter<String>>,
}
