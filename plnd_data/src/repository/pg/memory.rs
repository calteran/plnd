use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::memories::{create_memory, delete_memory, get_memories, update_memory};
use crate::db::models::UserMemory;
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
        category: Option<&str>,
    ) -> Result<Vec<UserMemory>, DatabaseError> {
        match category {
            Some(cat) => get_memories(&self.pool, user_id, &[cat]).await,
            None => get_memories(&self.pool, user_id, &[]).await,
        }
    }

    async fn save(
        &self,
        user_id: Uuid,
        category: &str,
        content: &str,
        tags: Vec<String>,
    ) -> Result<UserMemory, DatabaseError> {
        create_memory(&self.pool, user_id, category, content, tags).await
    }

    async fn update(
        &self,
        user_id: Uuid,
        memory_id: Uuid,
        content: &str,
    ) -> Result<UserMemory, DatabaseError> {
        update_memory(&self.pool, memory_id, user_id, content).await
    }

    async fn forget(&self, user_id: Uuid, memory_id: Uuid) -> Result<(), DatabaseError> {
        delete_memory(&self.pool, memory_id, user_id).await
    }
}
