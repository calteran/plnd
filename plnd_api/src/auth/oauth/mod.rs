// OAuth module providing provider-agnostic authentication

pub mod mock;
pub mod models;
pub mod provider;

pub use mock::MockOAuthProvider;
pub use models::{OAuthProviderConfig, OAuthToken, OAuthUserInfo};
pub use provider::OAuthProvider;
