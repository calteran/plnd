use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use super::error::DatabaseError;

#[derive(sqlx::FromRow, Serialize, Clone, Debug)]
pub struct LocalIngredientResult {
    pub ingredient_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub external_source: Option<String>,
}

#[derive(sqlx::FromRow, Serialize, Clone, Debug)]
pub struct LocalDishResult {
    pub dish_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub prep_time_minutes: Option<i32>,
    pub cook_time_minutes: Option<i32>,
    pub is_user_dish: bool,
}

#[derive(sqlx::FromRow, Serialize, Clone, Debug)]
pub struct LocalExerciseResult {
    pub exercise_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub intensity: String,
    pub muscle_groups: Vec<String>,
    pub external_source: Option<String>,
    pub is_user_exercise: bool,
}

#[tracing::instrument(
    skip(pool, exclude_allergens),
    fields(table = "catalog_ingredients", op = "search_ingredients")
)]
pub async fn search_ingredients(
    pool: &PgPool,
    q: &str,
    limit: i64,
    exclude_allergens: &[String],
    user_id: Option<Uuid>,
) -> Result<Vec<LocalIngredientResult>, DatabaseError> {
    sqlx::query_as::<_, LocalIngredientResult>(
        r#"
        SELECT ingredient_id, name, description,
               allergens, occasion_tags, external_source
        FROM catalog_ingredients
        WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
              @@ plainto_tsquery('english', $1)
          AND ($3::text[] = '{}' OR NOT allergens && $3::text[])
          AND ($4::uuid IS NULL OR NOT EXISTS (
              SELECT 1 FROM user_ingredient_prefs
              WHERE user_id = $4 AND catalog_ingredient_id = ingredient_id AND is_blocked = TRUE
          ))
        ORDER BY ts_rank(
            to_tsvector('english', name || ' ' || COALESCE(description, '')),
            plainto_tsquery('english', $1)
        ) DESC
        LIMIT $2
        "#,
    )
    .bind(q)
    .bind(limit)
    .bind(exclude_allergens)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "catalog_dishes", op = "search_dishes"))]
pub async fn search_dishes(
    pool: &PgPool,
    q: &str,
    limit: i64,
) -> Result<Vec<LocalDishResult>, DatabaseError> {
    sqlx::query_as::<_, LocalDishResult>(
        r#"
        SELECT dish_id, name, description,
               allergens, occasion_tags,
               prep_time_minutes, cook_time_minutes,
               false AS is_user_dish
        FROM catalog_dishes
        WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
              @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank(
            to_tsvector('english', name || ' ' || COALESCE(description, '')),
            plainto_tsquery('english', $1)
        ) DESC
        LIMIT $2
        "#,
    )
    .bind(q)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "user_dishes", op = "search_user_dishes"))]
pub async fn search_user_dishes(
    pool: &PgPool,
    user_id: Uuid,
    q: &str,
    limit: i64,
) -> Result<Vec<LocalDishResult>, DatabaseError> {
    sqlx::query_as::<_, LocalDishResult>(
        r#"
        SELECT dish_id, name, description,
               allergens, occasion_tags,
               prep_time_minutes, cook_time_minutes,
               true AS is_user_dish
        FROM user_dishes
        WHERE user_id = $2
          AND to_tsvector('english', name || ' ' || COALESCE(description, ''))
              @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank(
            to_tsvector('english', name || ' ' || COALESCE(description, '')),
            plainto_tsquery('english', $1)
        ) DESC
        LIMIT $3
        "#,
    )
    .bind(q)
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

/// FTS search over `catalog_ingredients`, returning only rows that have a
/// stored `nutrition` JSONB value (i.e., were sourced from USDA FDC or
/// Open Food Facts). Used by `EstimateNutritionFromDescriptionTool`.
#[tracing::instrument(
    skip(pool),
    fields(table = "catalog_ingredients", op = "search_ingredient_nutrition")
)]
pub async fn search_ingredient_nutrition(
    pool: &PgPool,
    q: &str,
    limit: i64,
) -> Result<Vec<super::models::CatalogIngredient>, DatabaseError> {
    sqlx::query_as::<_, super::models::CatalogIngredient>(
        r#"
        SELECT ingredient_id, name, description, serving_size_g, nutrition,
               allergens, occasion_tags, external_id, external_source,
               contributed_by_user_id, created_at, updated_at
        FROM catalog_ingredients
        WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
              @@ plainto_tsquery('english', $1)
          AND nutrition IS NOT NULL
        ORDER BY ts_rank(
            to_tsvector('english', name || ' ' || COALESCE(description, '')),
            plainto_tsquery('english', $1)
        ) DESC
        LIMIT $2
        "#,
    )
    .bind(q)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(
    skip(pool, exclude_allergens),
    fields(table = "catalog_meals", op = "search_catalog_meals")
)]
pub async fn search_catalog_meals(
    pool: &PgPool,
    q: &str,
    limit: i64,
    occasion: Option<&str>,
    exclude_allergens: &[String],
    user_id: Option<uuid::Uuid>,
) -> Result<Vec<super::models::CatalogMeal>, DatabaseError> {
    sqlx::query_as::<_, super::models::CatalogMeal>(
        r#"
        SELECT meal_id, name, description, servings, allergens, allergens_overridden,
               occasion_tags, tags, nutrition, nutrition_overridden,
               external_id, external_source, contributed_by_user_id, created_at, updated_at
        FROM catalog_meals
        WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
              @@ plainto_tsquery('english', $1)
          AND ($3::text IS NULL OR $3 = ANY(occasion_tags))
          AND ($4::text[] = '{}' OR NOT (allergens && $4::text[]))
          AND ($5::uuid IS NULL OR meal_id NOT IN (
              SELECT catalog_meal_id FROM user_meal_prefs
              WHERE user_id = $5 AND is_blocked AND catalog_meal_id IS NOT NULL
          ))
        ORDER BY ts_rank(
            to_tsvector('english', name || ' ' || COALESCE(description, '')),
            plainto_tsquery('english', $1)
        ) DESC
        LIMIT $2
        "#,
    )
    .bind(q)
    .bind(limit)
    .bind(occasion)
    .bind(exclude_allergens)
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(
    skip(pool),
    fields(table = "catalog_exercises", op = "search_exercises")
)]
pub async fn search_exercises(
    pool: &PgPool,
    q: &str,
    limit: i64,
) -> Result<Vec<LocalExerciseResult>, DatabaseError> {
    sqlx::query_as::<_, LocalExerciseResult>(
        r#"
        SELECT exercise_id, name, description,
               intensity, muscle_groups, external_source,
               false AS is_user_exercise
        FROM catalog_exercises
        WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
              @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank(
            to_tsvector('english', name || ' ' || COALESCE(description, '')),
            plainto_tsquery('english', $1)
        ) DESC
        LIMIT $2
        "#,
    )
    .bind(q)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    #[sqlx::test(migrations = "./migrations")]
    async fn search_catalog_meals_returns_match(pool: PgPool) {
        sqlx::query(
            "INSERT INTO catalog_meals (name, description, servings, allergens, occasion_tags, tags)
             VALUES ('Avocado Toast', 'toasted bread with avocado', 1.0, '{}', '{\"breakfast\"}', '{}')"
        )
        .execute(&pool)
        .await
        .unwrap();

        let results = search_catalog_meals(&pool, "avocado", 5, None, &[], None)
            .await
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Avocado Toast");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn search_ingredient_nutrition_returns_seeded_row(pool: PgPool) {
        sqlx::query(
            "INSERT INTO catalog_ingredients \
             (name, serving_size_g, nutrition, allergens, occasion_tags) \
             VALUES ('chicken breast', 100.0, \
               '{\"calories_kcal\": 165, \"protein_g\": 31, \"carbohydrates_g\": 0, \"fat_g\": 3.6}'::jsonb, \
               '{}', '{}')"
        )
        .execute(&pool)
        .await
        .unwrap();

        let results = search_ingredient_nutrition(&pool, "chicken", 1)
            .await
            .expect("query ok");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "chicken breast");
        assert!(results[0].nutrition.is_some());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn search_ingredient_nutrition_excludes_no_nutrition_rows(pool: PgPool) {
        sqlx::query(
            "INSERT INTO catalog_ingredients \
             (name, allergens, occasion_tags) \
             VALUES ('mystery food', '{}', '{}')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let results = search_ingredient_nutrition(&pool, "mystery food", 5)
            .await
            .expect("query ok");

        assert!(
            results.is_empty(),
            "should exclude rows with null nutrition"
        );
    }
}
