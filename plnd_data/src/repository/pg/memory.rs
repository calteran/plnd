use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;


use crate::db::memories::{create_memory, delete_memory, get_memories, update_memory};
use crate::models::UserMemory;
use crate::repository::memory::MemoryRepository;

pub struct PgMemoryRepository {
    pool: PgPool,
}

impl PgMemoryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl MemoryRepository for PgMemoryRepository {
    async fn get(
        &self,
        user_id: Uuid,
        categories: &[&str],
    ) -> Result<Vec<UserMemory>,crate::Error> {
        get_memories(&self.pool, user_id, categories).await.map_err(Into::into)
    }

    async fn save(
        &self,
        user_id: Uuid,
        category: &str,
        content: &str,
        tags: &[String],
    ) -> Result<UserMemory,crate::Error> {
        create_memory(&self.pool, user_id, category, content, tags.to_vec()).await.map_err(Into::into)
    }

    async fn update(
        &self,
        user_id: Uuid,
        memory_id: Uuid,
        content: &str,
    ) -> Result<UserMemory,crate::Error> {
        update_memory(&self.pool, memory_id, user_id, content).await.map_err(Into::into)
    }

    async fn forget(&self, user_id: Uuid, memory_id: Uuid) -> Result<(),crate::Error> {
        delete_memory(&self.pool, memory_id, user_id).await.map_err(Into::into)
    }
}
