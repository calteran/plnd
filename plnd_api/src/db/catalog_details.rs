use sqlx::PgPool;
use uuid::Uuid;

use super::models::{
    CatalogDish, CatalogDishIngredient, CatalogIngredient, CatalogMeal, CatalogMealDish,
};

pub async fn get_ingredient(
    pool: &PgPool,
    ingredient_id: Uuid,
) -> Result<Option<CatalogIngredient>, sqlx::Error> {
    sqlx::query_as::<_, CatalogIngredient>(
        "SELECT ingredient_id, name, description, serving_size_g, nutrition, allergens, occasion_tags, \
         external_id, external_source, contributed_by_user_id, created_at, updated_at \
         FROM catalog_ingredients WHERE ingredient_id = $1",
    )
    .bind(ingredient_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_dish(
    pool: &PgPool,
    dish_id: Uuid,
) -> Result<Option<(CatalogDish, Vec<CatalogDishIngredient>)>, sqlx::Error> {
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

pub async fn get_meal(
    pool: &PgPool,
    meal_id: Uuid,
) -> Result<Option<(CatalogMeal, Vec<CatalogMealDish>)>, sqlx::Error> {
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
