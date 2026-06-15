use sqlx::PgPool;
use uuid::Uuid;

use super::error::DatabaseError;

use crate::models::{
    CatalogDish, CatalogDishIngredient, CatalogIngredient, CatalogMeal, CatalogMealDish,
};

#[tracing::instrument(
    skip(pool),
    fields(table = "catalog_ingredients", op = "get_ingredient")
)]
pub async fn get_ingredient(
    pool: &PgPool,
    ingredient_id: Uuid,
) -> Result<Option<CatalogIngredient>, DatabaseError> {
    sqlx::query_as::<_, CatalogIngredient>(
        "SELECT ingredient_id, name, description, serving_size_g, nutrition, allergens, occasion_tags, \
         external_id, external_source, brand, contributed_by_user_id, created_at, updated_at \
         FROM catalog_ingredients WHERE ingredient_id = $1",
    )
    .bind(ingredient_id)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "catalog_dishes", op = "get_dish"))]
pub async fn get_dish(
    pool: &PgPool,
    dish_id: Uuid,
) -> Result<Option<(CatalogDish, Vec<CatalogDishIngredient>)>, DatabaseError> {
    let dish = sqlx::query_as::<_, CatalogDish>(
        "SELECT dish_id, name, description, instructions, prep_time_minutes, cook_time_minutes, \
         servings, allergens, allergens_overridden, occasion_tags, tags, nutrition, \
         nutrition_overridden, external_id, external_source, contributed_by_user_id, \
         created_at, updated_at \
         FROM catalog_dishes WHERE dish_id = $1",
    )
    .bind(dish_id)
    .fetch_optional(pool)
    .await?;

    let Some(dish) = dish else { return Ok(None) };

    let ingredients = sqlx::query_as::<_, CatalogDishIngredient>(
        "SELECT dish_ingredient_id, dish_id, ingredient_id, quantity, unit, \
         preparation_note, is_optional, sort_order \
         FROM catalog_dish_ingredients WHERE dish_id = $1 ORDER BY sort_order",
    )
    .bind(dish_id)
    .fetch_all(pool)
    .await?;

    Ok(Some((dish, ingredients)))
}

#[tracing::instrument(skip(pool), fields(table = "catalog_meals", op = "get_meal"))]
pub async fn get_meal(
    pool: &PgPool,
    meal_id: Uuid,
) -> Result<Option<(CatalogMeal, Vec<CatalogMealDish>)>, DatabaseError> {
    let meal = sqlx::query_as::<_, CatalogMeal>(
        "SELECT meal_id, name, description, servings, allergens, allergens_overridden, \
         occasion_tags, tags, nutrition, nutrition_overridden, external_id, external_source, \
         contributed_by_user_id, created_at, updated_at \
         FROM catalog_meals WHERE meal_id = $1",
    )
    .bind(meal_id)
    .fetch_optional(pool)
    .await?;

    let Some(meal) = meal else { return Ok(None) };

    let dishes = sqlx::query_as::<_, CatalogMealDish>(
        "SELECT meal_dish_id, meal_id, dish_id, dish_servings, notes, sort_order \
         FROM catalog_meal_dishes WHERE meal_id = $1 ORDER BY sort_order",
    )
    .bind(meal_id)
    .fetch_all(pool)
    .await?;

    Ok(Some((meal, dishes)))
}

#[tracing::instrument(
    skip(pool, ids),
    fields(table = "catalog_ingredients", op = "get_names_by_ids")
)]
pub async fn get_ingredient_names_by_ids(
    pool: &PgPool,
    ids: &[Uuid],
) -> Result<Vec<(Uuid, String)>, DatabaseError> {
    sqlx::query_as::<_, (Uuid, String)>(
        "SELECT ingredient_id, name FROM catalog_ingredients WHERE ingredient_id = ANY($1::uuid[])",
    )
    .bind(ids)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(
    skip(pool, ids),
    fields(table = "catalog_meals", op = "get_names_by_ids")
)]
pub async fn get_catalog_meal_names_by_ids(
    pool: &PgPool,
    ids: &[Uuid],
) -> Result<Vec<(Uuid, String)>, DatabaseError> {
    sqlx::query_as::<_, (Uuid, String)>(
        "SELECT meal_id, name FROM catalog_meals WHERE meal_id = ANY($1::uuid[])",
    )
    .bind(ids)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "catalog_meals", op = "get_nutrition"))]
pub async fn get_meal_nutrition(
    pool: &PgPool,
    meal_id: Uuid,
) -> Result<Option<Option<serde_json::Value>>, DatabaseError> {
    sqlx::query_as::<_, (Option<serde_json::Value>,)>(
        "SELECT nutrition FROM catalog_meals WHERE meal_id = $1",
    )
    .bind(meal_id)
    .fetch_optional(pool)
    .await
    .map(|row| row.map(|(n,)| n))
    .map_err(DatabaseError::from)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(migrations = "./migrations")]
    async fn get_ingredient_names_by_ids_returns_names(pool: PgPool) {
        let (id_a, id_b) = sqlx::query_as::<_, (Uuid, Uuid)>(
            "WITH a AS (
                INSERT INTO catalog_ingredients (name, allergens, occasion_tags)
                VALUES ('Chicken', '{}', '{}') RETURNING ingredient_id
             ),
             b AS (
                INSERT INTO catalog_ingredients (name, allergens, occasion_tags)
                VALUES ('Broccoli', '{}', '{}') RETURNING ingredient_id
             )
             SELECT a.ingredient_id, b.ingredient_id FROM a, b",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let results = get_ingredient_names_by_ids(&pool, &[id_a, id_b])
            .await
            .unwrap();

        assert_eq!(results.len(), 2);
        let names: Vec<_> = results.iter().map(|(_, n)| n.as_str()).collect();
        assert!(names.contains(&"Chicken"));
        assert!(names.contains(&"Broccoli"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_ingredient_names_by_ids_returns_empty_for_empty_input(pool: PgPool) {
        let results = get_ingredient_names_by_ids(&pool, &[]).await.unwrap();
        assert!(results.is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_meal_nutrition_returns_nutrition(pool: PgPool) {
        let nutrition = serde_json::json!({"calories_kcal": 500, "protein_g": 30});
        let (meal_id,): (Uuid,) = sqlx::query_as(
            "INSERT INTO catalog_meals (name, servings, allergens, occasion_tags, tags, nutrition)
             VALUES ('Test Meal', 1.0, '{}', '{}', '{}', $1)
             RETURNING meal_id",
        )
        .bind(&nutrition)
        .fetch_one(&pool)
        .await
        .unwrap();

        let result = get_meal_nutrition(&pool, meal_id).await.unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap(), Some(nutrition));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_meal_nutrition_returns_none_when_not_found(pool: PgPool) {
        let result = get_meal_nutrition(&pool, Uuid::new_v4()).await.unwrap();
        assert!(result.is_none());
    }
}
