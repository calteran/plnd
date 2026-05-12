use crate::auth::{JwksCache, JwtService, SessionService};
use crate::briefing::BriefingState;
use governor::DefaultKeyedRateLimiter;
use plnd_agent::AgentService;
use plnd_data::Repositories;
use plnd_data::search::ProviderSearchService;
use std::sync::Arc;

/// Shared application state available to all route handlers
#[derive(Clone)]
pub struct AppState {
    /// Repository layer — typed access to all storage-backed domain operations.
    pub repos: Repositories,
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
    /// Per-user rate limiter for POST /agent/task. Keyed by authenticated user_id (UUID string).
    pub agent_task_limiter: Arc<DefaultKeyedRateLimiter<String>>,
    /// Agent service for LLM-backed task and meal-plan generation.
    pub agent: AgentService,
    /// Max parallel LLM calls per POST /agent/meal-plan request.
    /// Bounded by a per-request semaphore; parallel slots see only locked context.
    pub meal_plan_concurrency: usize,
}
