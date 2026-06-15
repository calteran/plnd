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
    pub brand: Option<String>,
}

pub struct ContributeIngredientInput {
    pub name: String,
    pub contributed_by_user_id: Uuid,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
}

pub struct DishIngredientLinkInput {
    pub ingredient_id: Uuid,
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
    pub sort_order: i16,
}

pub struct IngestDishInput {
    pub external_source: String,
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub nutrition: Option<Value>,
    pub contributed_by_user_id: Option<Uuid>,
    pub ingredients: Vec<DishIngredientLinkInput>,
}

pub struct MealDishLinkInput {
    pub dish_id: Uuid,
    pub dish_servings: Decimal,
    pub sort_order: i16,
}

pub struct IngestMealInput {
    pub external_source: String,
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub tags: Vec<String>,
    pub nutrition: Option<Value>,
    pub contributed_by_user_id: Option<Uuid>,
    pub dishes: Vec<MealDishLinkInput>,
}

#[async_trait]
pub trait CatalogIngestRepository: Send + Sync {
    async fn ingest_ingredient(&self, input: IngestIngredientInput) -> Result<Uuid, crate::Error>;
    async fn contribute_ingredient(
        &self,
        input: ContributeIngredientInput,
    ) -> Result<Uuid, crate::Error>;
    async fn ingest_dish(&self, input: IngestDishInput) -> Result<Uuid, crate::Error>;
    async fn ingest_meal(&self, input: IngestMealInput) -> Result<Uuid, crate::Error>;
}
