use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::catalog_ingest::{self, IngestIngredientParams};
use crate::db::error::DatabaseError;
use crate::repository::catalog_ingest::{CatalogIngestRepository, IngestIngredientInput};

pub struct PgCatalogIngestRepository {
    pool: PgPool,
}

impl PgCatalogIngestRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CatalogIngestRepository for PgCatalogIngestRepository {
    async fn ingest_ingredient(&self, input: IngestIngredientInput) -> Result<Uuid, DatabaseError> {
        catalog_ingest::ingest_ingredient(
            &self.pool,
            IngestIngredientParams {
                external_source: &input.external_source,
                external_id: &input.external_id,
                name: &input.name,
                description: input.description.as_deref(),
                serving_size_g: input.serving_size_g,
                nutrition: input.nutrition,
                allergens: &input.allergens,
                occasion_tags: &input.occasion_tags,
            },
        )
        .await
    }
}
