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
    pub brand: Option<&'a str>,
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
                 brand, external_source, external_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (external_source, external_id) DO NOTHING
            RETURNING ingredient_id
        )
        SELECT ingredient_id FROM ins
        UNION ALL
        SELECT ingredient_id FROM catalog_ingredients
        WHERE external_source = $8 AND external_id = $9
        LIMIT 1
        "#,
    )
    .bind(params.name)
    .bind(params.description)
    .bind(params.serving_size_g)
    .bind(params.nutrition)
    .bind(params.allergens)
    .bind(params.occasion_tags)
    .bind(params.brand)
    .bind(params.external_source)
    .bind(params.external_id)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
    .map(|(id,)| id)
}

pub struct ContributeIngredientParams<'a> {
    pub name: &'a str,
    pub contributed_by_user_id: Uuid,
    pub allergens: &'a [String],
    pub occasion_tags: &'a [String],
}

#[tracing::instrument(
    skip(pool, params),
    fields(table = "catalog_ingredients", op = "contribute_ingredient")
)]
pub async fn contribute_ingredient(
    pool: &PgPool,
    params: ContributeIngredientParams<'_>,
) -> Result<Uuid, DatabaseError> {
    sqlx::query_as::<_, (Uuid,)>(
        "INSERT INTO catalog_ingredients (name, allergens, occasion_tags, contributed_by_user_id) \
         VALUES ($1, $2, $3, $4) RETURNING ingredient_id",
    )
    .bind(params.name)
    .bind(params.allergens)
    .bind(params.occasion_tags)
    .bind(params.contributed_by_user_id)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
    .map(|(id,)| id)
}

/// A resolved ingredient link for a dish — the ingredient row already exists.
pub struct DishIngredientLink {
    pub ingredient_id: Uuid,
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
    pub sort_order: i16,
}

pub struct IngestDishParams<'a> {
    pub external_source: &'a str,
    pub external_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub instructions: Option<&'a str>,
    pub servings: Decimal,
    pub allergens: &'a [String],
    pub occasion_tags: &'a [String],
    pub nutrition: Option<Value>,
    pub contributed_by_user_id: Option<Uuid>,
    pub ingredients: &'a [DishIngredientLink],
}

#[tracing::instrument(
    skip(pool, params),
    fields(table = "catalog_dishes", op = "ingest_dish")
)]
pub async fn ingest_dish(
    pool: &PgPool,
    params: IngestDishParams<'_>,
) -> Result<Uuid, DatabaseError> {
    let mut tx = pool.begin().await?;

    // Intentionally empty for the ingest path; the auto-seeder applies AUTO_SEEDED_TAG.
    let tags = Vec::<String>::new();
    // Upsert the dish on the external key; RETURNING gives the canonical dish_id
    // whether we inserted or matched an existing row.
    let (dish_id,) = sqlx::query_as::<_, (Uuid,)>(
        r#"
        INSERT INTO catalog_dishes
            (name, description, instructions, servings, allergens, allergens_overridden,
             occasion_tags, nutrition, nutrition_overridden, tags,
             external_source, external_id, contributed_by_user_id)
        VALUES ($1, $2, $3, $4, $5, false, $6, $7, false, $8, $9, $10, $11)
        ON CONFLICT ON CONSTRAINT uq_dish_external DO UPDATE SET
            name          = EXCLUDED.name,
            description   = EXCLUDED.description,
            instructions  = EXCLUDED.instructions,
            servings      = EXCLUDED.servings,
            allergens     = CASE WHEN catalog_dishes.allergens_overridden
                                 THEN catalog_dishes.allergens ELSE EXCLUDED.allergens END,
            occasion_tags = EXCLUDED.occasion_tags,
            nutrition     = CASE WHEN catalog_dishes.nutrition_overridden
                                 THEN catalog_dishes.nutrition ELSE EXCLUDED.nutrition END,
            updated_at    = now()
        RETURNING dish_id
        "#,
    )
    .bind(params.name)
    .bind(params.description)
    .bind(params.instructions)
    .bind(params.servings)
    .bind(params.allergens)
    .bind(params.occasion_tags)
    .bind(&params.nutrition)
    .bind(&tags)
    .bind(params.external_source)
    .bind(params.external_id)
    .bind(params.contributed_by_user_id)
    .fetch_one(&mut *tx)
    .await?;

    for link in params.ingredients {
        sqlx::query(
            r#"
            INSERT INTO catalog_dish_ingredients
                (dish_id, ingredient_id, quantity, unit, preparation_note, is_optional, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT ON CONSTRAINT uq_dish_ingredient DO UPDATE SET
                quantity         = EXCLUDED.quantity,
                unit             = EXCLUDED.unit,
                preparation_note = EXCLUDED.preparation_note,
                is_optional      = EXCLUDED.is_optional,
                sort_order       = EXCLUDED.sort_order
            "#,
        )
        .bind(dish_id)
        .bind(link.ingredient_id)
        .bind(link.quantity)
        .bind(&link.unit)
        .bind(&link.preparation_note)
        .bind(link.is_optional)
        .bind(link.sort_order)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(dish_id)
}

/// A meal→dish link; the dish row already exists.
pub struct MealDishLink {
    pub dish_id: Uuid,
    pub dish_servings: Decimal,
    pub sort_order: i16,
}

pub struct IngestMealParams<'a> {
    pub external_source: &'a str,
    pub external_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub servings: Decimal,
    pub allergens: &'a [String],
    pub occasion_tags: &'a [String],
    pub tags: &'a [String],
    pub nutrition: Option<Value>,
    pub contributed_by_user_id: Option<Uuid>,
    pub dishes: &'a [MealDishLink],
}

#[tracing::instrument(
    skip(pool, params),
    fields(table = "catalog_meals", op = "ingest_meal")
)]
pub async fn ingest_meal(
    pool: &PgPool,
    params: IngestMealParams<'_>,
) -> Result<Uuid, DatabaseError> {
    let mut tx = pool.begin().await?;

    let (meal_id,) = sqlx::query_as::<_, (Uuid,)>(
        r#"
        INSERT INTO catalog_meals
            (name, description, servings, allergens, allergens_overridden,
             occasion_tags, tags, nutrition, nutrition_overridden,
             external_source, external_id, contributed_by_user_id)
        VALUES ($1, $2, $3, $4, false, $5, $6, $7, false, $8, $9, $10)
        ON CONFLICT ON CONSTRAINT uq_meal_external DO UPDATE SET
            name          = EXCLUDED.name,
            description   = EXCLUDED.description,
            servings      = EXCLUDED.servings,
            allergens     = CASE WHEN catalog_meals.allergens_overridden
                                 THEN catalog_meals.allergens ELSE EXCLUDED.allergens END,
            occasion_tags = EXCLUDED.occasion_tags,
            tags          = EXCLUDED.tags,
            nutrition     = CASE WHEN catalog_meals.nutrition_overridden
                                 THEN catalog_meals.nutrition ELSE EXCLUDED.nutrition END,
            updated_at    = now()
        RETURNING meal_id
        "#,
    )
    .bind(params.name)
    .bind(params.description)
    .bind(params.servings)
    .bind(params.allergens)
    .bind(params.occasion_tags)
    .bind(params.tags)
    .bind(&params.nutrition)
    .bind(params.external_source)
    .bind(params.external_id)
    .bind(params.contributed_by_user_id)
    .fetch_one(&mut *tx)
    .await?;

    for link in params.dishes {
        sqlx::query(
            r#"
            INSERT INTO catalog_meal_dishes (meal_id, dish_id, dish_servings, sort_order)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT ON CONSTRAINT uq_meal_dish DO UPDATE SET
                dish_servings = EXCLUDED.dish_servings,
                sort_order    = EXCLUDED.sort_order
            "#,
        )
        .bind(meal_id)
        .bind(link.dish_id)
        .bind(link.dish_servings)
        .bind(link.sort_order)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(meal_id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::users;

    async fn new_user(pool: &PgPool) -> Uuid {
        users::create(
            pool,
            &format!("{}@test.invalid", Uuid::new_v4()),
            None,
            None,
        )
        .await
        .expect("failed to create test user")
        .user_id
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn contribute_ingredient_inserts_user_attributed_row(pool: PgPool) {
        let uid = new_user(&pool).await;

        let ingredient_id = contribute_ingredient(
            &pool,
            ContributeIngredientParams {
                name: "User-Contributed Tomato",
                contributed_by_user_id: uid,
                allergens: &[],
                occasion_tags: &[],
            },
        )
        .await
        .expect("contribute_ingredient failed");

        let row: (Uuid, String, Option<String>, Option<String>, Option<Uuid>) = sqlx::query_as(
            "SELECT ingredient_id, name, external_source, external_id, contributed_by_user_id \
             FROM catalog_ingredients WHERE ingredient_id = $1",
        )
        .bind(ingredient_id)
        .fetch_one(&pool)
        .await
        .expect("row not found");

        assert_eq!(row.0, ingredient_id);
        assert_eq!(row.1, "User-Contributed Tomato");
        assert!(row.2.is_none(), "external_source must be NULL for path 3");
        assert!(row.3.is_none(), "external_id must be NULL for path 3");
        assert_eq!(row.4, Some(uid));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn ingest_meal_returns_meal_id(pool: PgPool) {
        let external_id = Uuid::new_v4().to_string();
        let meal_id = ingest_meal(
            &pool,
            IngestMealParams {
                external_source: "test",
                external_id: &external_id,
                name: "Test Oatmeal",
                description: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["breakfast".to_string()],
                tags: &[],
                nutrition: None,
                contributed_by_user_id: None,
                dishes: &[],
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
    async fn ingest_dish_links_resolvable_ingredients(pool: PgPool) {
        // Seed one catalog ingredient to link against.
        let ing_id = ingest_ingredient(
            &pool,
            IngestIngredientParams {
                external_source: "usda_fdc",
                external_id: "tomato-1",
                name: "Tomato",
                description: None,
                serving_size_g: Some(Decimal::from(100)),
                nutrition: Some(serde_json::json!({"calories_kcal": 18})),
                allergens: &[],
                occasion_tags: &[],
                brand: None,
            },
        )
        .await
        .unwrap();

        let dish_id = ingest_dish(
            &pool,
            IngestDishParams {
                external_source: "themealdb",
                external_id: "recipe-1",
                name: "Tomato Soup",
                description: None,
                instructions: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                nutrition: None,
                contributed_by_user_id: None,
                ingredients: &[DishIngredientLink {
                    ingredient_id: ing_id,
                    quantity: Decimal::from(2),
                    unit: "cup".to_string(),
                    preparation_note: None,
                    is_optional: false,
                    sort_order: 0,
                }],
            },
        )
        .await
        .unwrap();

        // The linked row's content must round-trip through the join table.
        let (quantity, unit, sort_order): (Decimal, String, i16) = sqlx::query_as(
            "SELECT quantity, unit, sort_order FROM catalog_dish_ingredients WHERE dish_id = $1",
        )
        .bind(dish_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(quantity, Decimal::from(2));
        assert_eq!(unit, "cup");
        assert_eq!(sort_order, 0);

        // Re-ingest is idempotent: same external key returns the same dish_id.
        let dish_id_again = ingest_dish(
            &pool,
            IngestDishParams {
                external_source: "themealdb",
                external_id: "recipe-1",
                name: "Tomato Soup",
                description: None,
                instructions: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                nutrition: None,
                contributed_by_user_id: None,
                ingredients: &[],
            },
        )
        .await
        .unwrap();
        assert_eq!(
            dish_id, dish_id_again,
            "re-ingest must return the same dish_id"
        );

        let link_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM catalog_dish_ingredients WHERE dish_id = $1")
                .bind(dish_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            link_count, 1,
            "the resolvable ingredient must be linked exactly once"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn ingest_meal_stores_nutrition(pool: PgPool) {
        let external_id = Uuid::new_v4().to_string();
        let nutrition = serde_json::json!({"calories_kcal": 200, "protein_g": 10});
        let meal_id = ingest_meal(
            &pool,
            IngestMealParams {
                external_source: "test",
                external_id: &external_id,
                name: "Test Soup",
                description: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                tags: &[],
                nutrition: Some(nutrition.clone()),
                contributed_by_user_id: None,
                dishes: &[],
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

    #[sqlx::test(migrations = "./migrations")]
    async fn ingest_meal_links_dishes_and_is_idempotent(pool: PgPool) {
        let dish_id = ingest_dish(
            &pool,
            IngestDishParams {
                external_source: "themealdb",
                external_id: "recipe-2",
                name: "Grilled Cheese",
                description: None,
                instructions: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                nutrition: None,
                contributed_by_user_id: None,
                ingredients: &[],
            },
        )
        .await
        .unwrap();

        let meal_id = ingest_meal(
            &pool,
            IngestMealParams {
                external_source: "themealdb",
                external_id: "recipe-2",
                name: "Grilled Cheese",
                description: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                tags: &[],
                nutrition: Some(serde_json::json!({"calories_kcal": 400})),
                contributed_by_user_id: None,
                dishes: &[MealDishLink {
                    dish_id,
                    dish_servings: Decimal::from(1),
                    sort_order: 0,
                }],
            },
        )
        .await
        .unwrap();

        let meal_id_again = ingest_meal(
            &pool,
            IngestMealParams {
                external_source: "themealdb",
                external_id: "recipe-2",
                name: "Grilled Cheese",
                description: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                tags: &[],
                nutrition: Some(serde_json::json!({"calories_kcal": 400})),
                contributed_by_user_id: None,
                dishes: &[MealDishLink {
                    dish_id,
                    dish_servings: Decimal::from(1),
                    sort_order: 0,
                }],
            },
        )
        .await
        .unwrap();
        assert_eq!(meal_id, meal_id_again);

        let link_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM catalog_meal_dishes WHERE meal_id = $1")
                .bind(meal_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(link_count, 1);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn ingest_ingredient_stores_brand_and_brands_share_generic_name(pool: PgPool) {
        let great_value = ingest_ingredient(
            &pool,
            IngestIngredientParams {
                external_source: "openfoodfacts",
                external_id: "off-1",
                name: "Cheddar cheese",
                description: None,
                serving_size_g: None,
                nutrition: None,
                allergens: &[],
                occasion_tags: &[],
                brand: Some("Great Value"),
            },
        )
        .await
        .unwrap();

        let kraft = ingest_ingredient(
            &pool,
            IngestIngredientParams {
                external_source: "openfoodfacts",
                external_id: "off-2",
                name: "Cheddar cheese",
                description: None,
                serving_size_g: None,
                nutrition: None,
                allergens: &[],
                occasion_tags: &[],
                brand: Some("Kraft"),
            },
        )
        .await
        .unwrap();

        assert_ne!(great_value, kraft, "distinct external ids → distinct rows");

        let brand: Option<String> =
            sqlx::query_scalar("SELECT brand FROM catalog_ingredients WHERE ingredient_id = $1")
                .bind(great_value)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(brand.as_deref(), Some("Great Value"));

        let kraft_brand: Option<String> =
            sqlx::query_scalar("SELECT brand FROM catalog_ingredients WHERE ingredient_id = $1")
                .bind(kraft)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(kraft_brand.as_deref(), Some("Kraft"));

        let shared: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM catalog_ingredients WHERE name = 'Cheddar cheese'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(shared, 2, "both brands coexist under one generic name");
    }
}
