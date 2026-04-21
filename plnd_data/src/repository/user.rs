use async_trait::async_trait;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::User;

#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn find_by_id(&self, user_id: Uuid) -> Result<Option<User>, DatabaseError>;
    async fn update_profile(
        &self,
        user_id: Uuid,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<Option<User>, DatabaseError>;
    async fn complete_onboarding(&self, user_id: Uuid) -> Result<bool, DatabaseError>;
    async fn deactivate_user(&self, user_id: Uuid) -> Result<bool, DatabaseError>;
}
