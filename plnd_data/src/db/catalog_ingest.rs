use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

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

#[tracing::instrument(skip(pool, params), fields(table = "catalog_ingredients", op = "ingest_ingredient"))]
pub async fn ingest_ingredient(
    pool: &PgPool,
    params: IngestIngredientParams<'_>,
) -> Result<Uuid, sqlx::Error> {
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
    .map(|(id,)| id)
}
