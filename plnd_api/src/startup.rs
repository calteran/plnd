use std::num::NonZeroU32;
use std::sync::Arc;

use governor::{Quota, RateLimiter};

use plnd_api::auth::{JwksCache, JwtService, SessionService};
use plnd_api::state::AppState;

use crate::providers;

/// Build the shared `AppState`: repositories, auth services, rate limiters,
/// the agent service, external providers, and the background catalog seed.
///
/// Emits the configuration/database/OIDC startup logs. Returns `Err` on a
/// database-connection failure; the caller exits.
pub async fn build_state(
    config: &plnd_api::config::settings::AppConfig,
) -> Result<Arc<AppState>, Box<dyn std::error::Error + Send + Sync>> {
    tracing::info!(
        api_base_url = %config.api.base_url,
        log_level = %config.logging.level,
        otel_enabled = config.otel.endpoint.is_some(),
        "configuration loaded"
    );

    let repos =
        plnd_data::Repositories::new(&config.database.url, config.database.max_connections as u32)
            .await?;
    tracing::info!("database connected and migrations applied");

    let jwt = JwtService::new(
        config.auth.jwt.secret.clone(),
        config.auth.jwt.jwt_expiration,
    );

    // internal_issuer_url (Docker-internal host) for server-to-server JWKS fetch;
    // external issuer_url validates the token `iss` claim.
    let internal_issuer = if config.auth.oidc.internal_issuer_url.is_empty() {
        config.auth.oidc.issuer_url.clone()
    } else {
        config.auth.oidc.internal_issuer_url.clone()
    };
    let jwks = JwksCache::new(config.auth.oidc.issuer_url.clone(), internal_issuer);
    tracing::info!(
        issuer = %config.auth.oidc.issuer_url,
        client_id = %config.auth.oidc.client_id,
        "OIDC configured"
    );

    let providers = providers::build(&config.external_providers, &config.llm);

    // Seed catalog tables in the background so the server binds immediately.
    // Idempotent; failures are non-fatal warnings.
    {
        let seed_url = config.database.url.clone();
        let seed_recipe = providers.catalog_recipe.clone();
        tokio::spawn(async move {
            let corpus_path = plnd_seed::ingredients::resolve_corpus_path();
            if let Err(e) = plnd_seed::run_seed(&seed_url, 3, &seed_recipe, &corpus_path).await {
                tracing::warn!(error = %e, "catalog seed failed (non-fatal)");
            }
        });
    }

    // Per-IP limiter for unauthenticated /client_error: 20 req/min/IP.
    let client_error_quota = Quota::per_minute(NonZeroU32::new(20).unwrap());
    let client_error_limiter = Arc::new(RateLimiter::keyed(client_error_quota));

    // Per-user limiter for POST /agent/task (env-driven, default 10 req/min).
    let agent_task_quota =
        Quota::per_minute(NonZeroU32::new(config.agent.rate_limit_per_minute).unwrap());
    let agent_task_limiter = Arc::new(RateLimiter::keyed(agent_task_quota));

    let session = SessionService::with_repo(repos.session.clone());
    let agent = plnd_agent::AgentService::new(&config.llm, repos.clone());

    Ok(Arc::new(AppState {
        repos,
        jwt,
        session,
        jwks,
        oidc_client_id: config.auth.oidc.client_id.clone(),
        provider_search: providers.search,
        briefing: providers.briefing,
        client_error_limiter,
        agent_task_limiter,
        agent,
        brand_normalizer: providers.brand_normalizer,
        meal_plan_concurrency: config.agent.meal_plan_concurrency,
    }))
}
