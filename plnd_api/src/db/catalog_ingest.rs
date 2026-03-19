use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn ingest_ingredient(
    pool: &PgPool,
    external_source: &str,
    external_id: &str,
    name: &str,
    description: Option<&str>,
    serving_size_g: Option<Decimal>,
    nutrition: Option<Value>,
    allergens: &[String],
    occasion_tags: &[String],
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
    .bind(name)
    .bind(description)
    .bind(serving_size_g)
    .bind(nutrition)
    .bind(allergens)
    .bind(occasion_tags)
    .bind(external_source)
    .bind(external_id)
    .fetch_one(pool)
    .await
    .map(|(id,)| id)
}
