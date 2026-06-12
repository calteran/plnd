use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::catalog_ingest::{
    self, ContributeIngredientParams, DishIngredientLink, IngestDishParams, IngestIngredientParams,
    IngestMealParams, MealDishLink,
};

use crate::repository::catalog_ingest::{
    CatalogIngestRepository, ContributeIngredientInput, IngestDishInput, IngestIngredientInput,
    IngestMealInput,
};

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
    async fn ingest_ingredient(&self, input: IngestIngredientInput) -> Result<Uuid, crate::Error> {
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
        .map_err(Into::into)
    }

    async fn contribute_ingredient(
        &self,
        input: ContributeIngredientInput,
    ) -> Result<Uuid, crate::Error> {
        catalog_ingest::contribute_ingredient(
            &self.pool,
            ContributeIngredientParams {
                name: &input.name,
                contributed_by_user_id: input.contributed_by_user_id,
                allergens: &input.allergens,
                occasion_tags: &input.occasion_tags,
            },
        )
        .await
        .map_err(Into::into)
    }

    async fn ingest_dish(&self, input: IngestDishInput) -> Result<Uuid, crate::Error> {
        let ingredients: Vec<DishIngredientLink> = input
            .ingredients
            .into_iter()
            .map(|i| DishIngredientLink {
                ingredient_id: i.ingredient_id,
                quantity: i.quantity,
                unit: i.unit,
                preparation_note: i.preparation_note,
                is_optional: i.is_optional,
                sort_order: i.sort_order,
            })
            .collect();
        catalog_ingest::ingest_dish(
            &self.pool,
            IngestDishParams {
                external_source: &input.external_source,
                external_id: &input.external_id,
                name: &input.name,
                description: input.description.as_deref(),
                instructions: input.instructions.as_deref(),
                servings: input.servings,
                allergens: &input.allergens,
                occasion_tags: &input.occasion_tags,
                nutrition: input.nutrition,
                contributed_by_user_id: input.contributed_by_user_id,
                ingredients: &ingredients,
            },
        )
        .await
        .map_err(Into::into)
    }

    async fn ingest_meal(&self, input: IngestMealInput) -> Result<Uuid, crate::Error> {
        let dishes: Vec<MealDishLink> = input
            .dishes
            .into_iter()
            .map(|d| MealDishLink {
                dish_id: d.dish_id,
                dish_servings: d.dish_servings,
                sort_order: d.sort_order,
            })
            .collect();
        catalog_ingest::ingest_meal(
            &self.pool,
            IngestMealParams {
                external_source: &input.external_source,
                external_id: &input.external_id,
                name: &input.name,
                description: input.description.as_deref(),
                servings: input.servings,
                allergens: &input.allergens,
                occasion_tags: &input.occasion_tags,
                tags: &input.tags,
                nutrition: input.nutrition,
                contributed_by_user_id: input.contributed_by_user_id,
                dishes: &dishes,
            },
        )
        .await
        .map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::catalog_ingest::{
        DishIngredientLinkInput, IngestDishInput, IngestMealInput, MealDishLinkInput,
    };
    use rust_decimal::Decimal;

    #[sqlx::test(migrations = "./migrations")]
    async fn repo_ingests_meal_through_trait(pool: PgPool) {
        let repo = PgCatalogIngestRepository::new(pool.clone());
        let dish_id = repo
            .ingest_dish(IngestDishInput {
                external_source: "llm_composed".into(),
                external_id: "compose-abc".into(),
                name: "Test Bowl".into(),
                description: None,
                instructions: None,
                servings: Decimal::from(1),
                allergens: vec![],
                occasion_tags: vec!["dinner".into()],
                nutrition: None,
                contributed_by_user_id: None,
                ingredients: vec![],
            })
            .await
            .unwrap();

        let meal_id = repo
            .ingest_meal(IngestMealInput {
                external_source: "llm_composed".into(),
                external_id: "compose-abc".into(),
                name: "Test Bowl".into(),
                description: None,
                servings: Decimal::from(1),
                allergens: vec![],
                occasion_tags: vec!["dinner".into()],
                tags: vec![],
                nutrition: None,
                contributed_by_user_id: None,
                dishes: vec![MealDishLinkInput {
                    dish_id,
                    dish_servings: Decimal::from(1),
                    sort_order: 0,
                }],
            })
            .await
            .unwrap();

        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM catalog_meals WHERE meal_id = $1)")
                .bind(meal_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(exists);

        // Exercise the ingredient-link input type too.
        let _ = DishIngredientLinkInput {
            ingredient_id: uuid::Uuid::nil(),
            quantity: Decimal::from(1),
            unit: "g".into(),
            preparation_note: None,
            is_optional: false,
            sort_order: 0,
        };
    }
}
