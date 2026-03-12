use crate::auth::oauth::MockOAuthProvider;
use crate::auth::{JwtService, SessionService};
use crate::db::Database;
use crate::search::ProviderSearchService;
use std::sync::Arc;

/// Shared application state available to all route handlers
#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub jwt: JwtService,
    pub session: SessionService,
    pub mock_provider: Arc<MockOAuthProvider>,
    /// The redirect_uri registered with the mock OAuth server (points back to this API)
    pub callback_uri: String,
    /// Where to send the browser after a successful login (Angular frontend)
    pub frontend_callback: String,
    pub provider_search: ProviderSearchService,
}
