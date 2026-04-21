use async_trait::async_trait;
use uuid::Uuid;

use crate::models::UserMemory;

#[async_trait]
pub trait MemoryRepository: Send + Sync {
    async fn get(
        &self,
        user_id: Uuid,
        categories: &[&str],
    ) -> Result<Vec<UserMemory>,crate::Error>;

    async fn save(
        &self,
        user_id: Uuid,
        category: &str,
        content: &str,
        tags: &[String],
    ) -> Result<UserMemory,crate::Error>;

    async fn update(
        &self,
        user_id: Uuid,
        memory_id: Uuid,
        content: &str,
    ) -> Result<UserMemory,crate::Error>;

    async fn forget(&self, user_id: Uuid, memory_id: Uuid) -> Result<(),crate::Error>;
}
