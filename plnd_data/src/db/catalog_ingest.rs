use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use super::error::DatabaseError;

pub struct IngestIngredientParams<'a> {
    pub external_source: &'a str,
    pub external_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub serving_size_g: Option<Decimal>,
    pub nutrition: Option<Value>,
    pub allergens: &'a [String],
    pub occasion_tags: &'a [String],
}

#[tracing::instrument(
    skip(pool, params),
    fields(table = "catalog_ingredients", op = "ingest_ingredient")
)]
pub async fn ingest_ingredient(
    pool: &PgPool,
    params: IngestIngredientParams<'_>,
) -> Result<Uuid, DatabaseError> {
    // Try to insert; if duplicate (external_source, external_id), DO NOTHING.
    // Then SELECT to get the ID whether we inserted or it already existed.
    sqlx::query_as::<_, (Uuid,)>(
        r#"
        WITH ins AS (
            INSERT INTO catalog_ingredients
                (name, description, serving_size_g, nutrition, allergens, occasion_tags,
                 external_source, external_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (external_source, external_id) DO NOTHING
            RETURNING ingredient_id
        )
        SELECT ingredient_id FROM ins
        UNION ALL
        SELECT ingredient_id FROM catalog_ingredients
        WHERE external_source = $7 AND external_id = $8
        LIMIT 1
        "#,
    )
    .bind(params.name)
    .bind(params.description)
    .bind(params.serving_size_g)
    .bind(params.nutrition)
    .bind(params.allergens)
    .bind(params.occasion_tags)
    .bind(params.external_source)
    .bind(params.external_id)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
    .map(|(id,)| id)
}

#[allow(dead_code)]
pub struct IngestMealParams<'a> {
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub servings: Decimal,
    pub allergens: &'a [String],
    pub occasion_tags: &'a [String],
    pub tags: &'a [String],
    pub nutrition: Option<Value>,
}

#[allow(dead_code)]
#[tracing::instrument(
    skip(pool, params),
    fields(table = "catalog_meals", op = "ingest_meal")
)]
pub async fn ingest_meal(
    pool: &PgPool,
    params: IngestMealParams<'_>,
) -> Result<Uuid, DatabaseError> {
    sqlx::query_as::<_, (Uuid,)>(
        "INSERT INTO catalog_meals \
         (name, description, servings, allergens, occasion_tags, tags, nutrition) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         RETURNING meal_id",
    )
    .bind(params.name)
    .bind(params.description)
    .bind(params.servings)
    .bind(params.allergens)
    .bind(params.occasion_tags)
    .bind(params.tags)
    .bind(params.nutrition)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
    .map(|(id,)| id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(migrations = "./migrations")]
    async fn ingest_meal_returns_meal_id(pool: PgPool) {
        let meal_id = ingest_meal(
            &pool,
            IngestMealParams {
                name: "Test Oatmeal",
                description: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["breakfast".to_string()],
                tags: &[],
                nutrition: None,
            },
        )
        .await
        .unwrap();

        let found = super::super::catalog_details::get_meal_nutrition(&pool, meal_id)
            .await
            .unwrap()
            .is_some();
        assert!(found, "meal should exist after ingest");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn ingest_meal_stores_nutrition(pool: PgPool) {
        let nutrition = serde_json::json!({"calories_kcal": 200, "protein_g": 10});
        let meal_id = ingest_meal(
            &pool,
            IngestMealParams {
                name: "Test Soup",
                description: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                tags: &[],
                nutrition: Some(nutrition.clone()),
            },
        )
        .await
        .unwrap();

        // Verify nutrition was stored using the new db layer function
        let result = super::super::catalog_details::get_meal_nutrition(&pool, meal_id)
            .await
            .unwrap();
        assert_eq!(result, Some(Some(nutrition)));
    }
}
