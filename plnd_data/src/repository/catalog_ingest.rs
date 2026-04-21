use async_trait::async_trait;
use rust_decimal::Decimal;
use serde_json::Value;
use uuid::Uuid;

pub struct IngestIngredientInput {
    pub external_source: String,
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    pub serving_size_g: Option<Decimal>,
    pub nutrition: Option<Value>,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
}

#[async_trait]
pub trait CatalogIngestRepository: Send + Sync {
    async fn ingest_ingredient(&self, input: IngestIngredientInput) -> Result<Uuid, crate::Error>;
}
