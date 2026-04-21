use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::users;
use crate::models::User;
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
    async fn find_by_id(&self, user_id: Uuid) -> Result<Option<User>, crate::Error> {
        users::find_by_id(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

    async fn update_profile(
        &self,
        user_id: Uuid,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<Option<User>, crate::Error> {
        users::update_profile(&self.pool, user_id, display_name, avatar_url)
            .await
            .map_err(Into::into)
    }

    async fn complete_onboarding(&self, user_id: Uuid) -> Result<bool, crate::Error> {
        users::complete_onboarding(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

    async fn deactivate_user(&self, user_id: Uuid) -> Result<bool, crate::Error> {
        users::deactivate_user(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }

    async fn find_by_provider(
        &self,
        provider: &str,
        sub: &str,
    ) -> Result<Option<User>, crate::Error> {
        users::find_by_provider(&self.pool, provider, sub)
            .await
            .map_err(Into::into)
    }

    async fn find_by_email(&self, email: &str) -> Result<Option<User>, crate::Error> {
        users::find_by_email(&self.pool, email)
            .await
            .map_err(Into::into)
    }

    async fn create(
        &self,
        email: &str,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<User, crate::Error> {
        users::create(&self.pool, email, display_name, avatar_url)
            .await
            .map_err(Into::into)
    }

    async fn link_oauth_provider(
        &self,
        user_id: Uuid,
        provider: &str,
        sub: &str,
    ) -> Result<(), crate::Error> {
        users::link_oauth_provider(&self.pool, user_id, provider, sub)
            .await
            .map_err(Into::into)
    }

    async fn touch_last_login(&self, user_id: Uuid) -> Result<(), crate::Error> {
        users::touch_last_login(&self.pool, user_id)
            .await
            .map_err(Into::into)
    }
}
