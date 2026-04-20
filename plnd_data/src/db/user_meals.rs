use sqlx::PgPool;
use uuid::Uuid;

use super::error::DatabaseError;

#[tracing::instrument(skip(pool), fields(table = "user_meals", op = "get_nutrition"))]
pub async fn get_nutrition(
    pool: &PgPool,
    meal_id: Uuid,
    user_id: Uuid,
) -> Result<Option<(Option<serde_json::Value>, bool)>, DatabaseError> {
    sqlx::query_as::<_, (Option<serde_json::Value>, bool)>(
        "SELECT nutrition, nutrition_estimated \
         FROM user_meals WHERE user_meal_id = $1 AND user_id = $2",
    )
    .bind(meal_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
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
    async fn get_nutrition_returns_nutrition_and_estimated_flag(pool: PgPool) {
        let uid = new_user(&pool).await;
        let nutrition = serde_json::json!({"calories_kcal": 400, "protein_g": 25});
        let (meal_id,): (Uuid,) = sqlx::query_as(
            "INSERT INTO user_meals (user_id, name, occasion_tags, nutrition, nutrition_estimated)
             VALUES ($1, 'My Meal', '{}', $2, true)
             RETURNING user_meal_id",
        )
        .bind(uid)
        .bind(&nutrition)
        .fetch_one(&pool)
        .await
        .unwrap();

        let result = get_nutrition(&pool, meal_id, uid).await.unwrap();
        assert!(result.is_some());
        let (returned_nutrition, estimated) = result.unwrap();
        assert_eq!(returned_nutrition, Some(nutrition));
        assert!(estimated);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_nutrition_returns_none_when_not_found(pool: PgPool) {
        let uid = new_user(&pool).await;
        let result = get_nutrition(&pool, Uuid::new_v4(), uid).await.unwrap();
        assert!(result.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_nutrition_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let (meal_id,): (Uuid,) = sqlx::query_as(
            "INSERT INTO user_meals (user_id, name, occasion_tags)
             VALUES ($1, 'Private Meal', '{}')
             RETURNING user_meal_id",
        )
        .bind(uid_a)
        .fetch_one(&pool)
        .await
        .unwrap();

        let result = get_nutrition(&pool, meal_id, uid_b).await.unwrap();
        assert!(result.is_none());
    }
}
