use async_trait::async_trait;
use uuid::Uuid;

use crate::models::User;

#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn find_by_id(&self, user_id: Uuid) -> Result<Option<User>, crate::Error>;
    async fn update_profile(
        &self,
        user_id: Uuid,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<Option<User>, crate::Error>;
    /// One-way: marks onboarding complete. Production path used by
    /// POST /users/me/complete-onboarding. Returns false (no error) when the
    /// user is already onboarded.
    async fn complete_onboarding(&self, user_id: Uuid) -> Result<bool, crate::Error>;
    /// Two-way: sets the flag to an explicit value. Used by test seeding to
    /// flip a user back to the un-onboarded state between tests.
    async fn set_onboarding_completed(
        &self,
        user_id: Uuid,
        completed: bool,
    ) -> Result<bool, crate::Error>;
    async fn deactivate_user(&self, user_id: Uuid) -> Result<bool, crate::Error>;

    async fn find_by_provider(
        &self,
        provider: &str,
        sub: &str,
    ) -> Result<Option<User>, crate::Error>;

    async fn find_by_email(&self, email: &str) -> Result<Option<User>, crate::Error>;

    async fn create(
        &self,
        email: &str,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<User, crate::Error>;

    async fn link_oauth_provider(
        &self,
        user_id: Uuid,
        provider: &str,
        sub: &str,
    ) -> Result<(), crate::Error>;

    async fn touch_last_login(&self, user_id: Uuid) -> Result<(), crate::Error>;
}
