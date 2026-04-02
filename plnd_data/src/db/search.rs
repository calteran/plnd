use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

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

#[tracing::instrument(skip(pool, exclude_allergens), fields(table = "catalog_ingredients", op = "search_ingredients"))]
pub async fn search_ingredients(
    pool: &PgPool,
    q: &str,
    limit: i64,
    exclude_allergens: &[String],
    user_id: Option<Uuid>,
) -> Result<Vec<LocalIngredientResult>, sqlx::Error> {
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
}

#[tracing::instrument(skip(pool), fields(table = "catalog_dishes", op = "search_dishes"))]
pub async fn search_dishes(
    pool: &PgPool,
    q: &str,
    limit: i64,
) -> Result<Vec<LocalDishResult>, sqlx::Error> {
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
}

#[tracing::instrument(skip(pool), fields(table = "user_dishes", op = "search_user_dishes"))]
pub async fn search_user_dishes(
    pool: &PgPool,
    user_id: Uuid,
    q: &str,
    limit: i64,
) -> Result<Vec<LocalDishResult>, sqlx::Error> {
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
}

#[tracing::instrument(skip(pool), fields(table = "catalog_exercises", op = "search_exercises"))]
pub async fn search_exercises(
    pool: &PgPool,
    q: &str,
    limit: i64,
) -> Result<Vec<LocalExerciseResult>, sqlx::Error> {
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
}
