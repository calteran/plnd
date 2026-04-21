use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::User;
use crate::db::users as db;
use crate::repository::user::UserRepository;

pub struct PgUserRepository {
    pool: PgPool,
}

impl PgUserRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UserRepository for PgUserRepository {
    async fn find_by_id(&self, user_id: Uuid) -> Result<Option<User>, DatabaseError> {
        db::find_by_id(&self.pool, user_id).await
    }

    async fn update_profile(
        &self,
        user_id: Uuid,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<Option<User>, DatabaseError> {
        db::update_profile(&self.pool, user_id, display_name, avatar_url).await
    }

    async fn complete_onboarding(&self, user_id: Uuid) -> Result<bool, DatabaseError> {
        db::complete_onboarding(&self.pool, user_id).await
    }

    async fn deactivate_user(&self, user_id: Uuid) -> Result<bool, DatabaseError> {
        db::deactivate_user(&self.pool, user_id).await
    }
}
