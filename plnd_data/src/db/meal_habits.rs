use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::MealHabit;

/// List all meal habits for a user, ordered by creation time.
#[tracing::instrument(skip(pool), fields(table = "user_meal_habits", op = "list"))]
pub async fn list(pool: &PgPool, user_id: Uuid) -> Result<Vec<MealHabit>, DatabaseError> {
    sqlx::query_as::<_, MealHabit>(
        "SELECT id, user_id, meal_name, slot, recurrence_rule, created_at
         FROM user_meal_habits
         WHERE user_id = $1
         ORDER BY created_at",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Insert a new meal habit, returning the created record.
#[tracing::instrument(skip(pool), fields(table = "user_meal_habits", op = "create"))]
pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    meal_name: &str,
    slot: &str,
    recurrence_rule: &str,
) -> Result<MealHabit, DatabaseError> {
    sqlx::query_as::<_, MealHabit>(
        "INSERT INTO user_meal_habits (user_id, meal_name, slot, recurrence_rule)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, meal_name, slot, recurrence_rule, created_at",
    )
    .bind(user_id)
    .bind(meal_name)
    .bind(slot)
    .bind(recurrence_rule)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Delete a meal habit. Returns true if a row was deleted, false if not found
/// or the habit does not belong to the given user.
#[tracing::instrument(skip(pool), fields(table = "user_meal_habits", op = "delete"))]
pub async fn delete(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<bool, DatabaseError> {
    sqlx::query("DELETE FROM user_meal_habits WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await
        .map(|r| r.rows_affected() > 0)
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

    // -----------------------------------------------------------------------
    // list
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn list_returns_empty_for_new_user(pool: PgPool) {
        let uid = new_user(&pool).await;
        let result = list(&pool, uid).await.unwrap();
        assert!(result.is_empty());
    }

    // -----------------------------------------------------------------------
    // create
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn create_returns_habit(pool: PgPool) {
        let uid = new_user(&pool).await;

        let habit = create(&pool, uid, "Oatmeal", "breakfast", "FREQ=WEEKLY;BYDAY=MO,WE,FR")
            .await
            .expect("create failed");

        assert_eq!(habit.user_id, uid);
        assert_eq!(habit.meal_name, "Oatmeal");
        assert_eq!(habit.slot, "breakfast");
        assert_eq!(habit.recurrence_rule, "FREQ=WEEKLY;BYDAY=MO,WE,FR");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_returns_created_habits(pool: PgPool) {
        let uid = new_user(&pool).await;

        create(&pool, uid, "Oatmeal", "breakfast", "FREQ=DAILY")
            .await
            .unwrap();
        create(&pool, uid, "Salad", "lunch", "FREQ=WEEKLY;BYDAY=MO")
            .await
            .unwrap();

        let result = list(&pool, uid).await.unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|h| h.user_id == uid));
    }

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_true(pool: PgPool) {
        let uid = new_user(&pool).await;
        let habit = create(&pool, uid, "Oatmeal", "breakfast", "FREQ=DAILY")
            .await
            .unwrap();

        let deleted = delete(&pool, habit.id, uid).await.unwrap();
        assert!(deleted);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_false_for_unknown(pool: PgPool) {
        let uid = new_user(&pool).await;
        let deleted = delete(&pool, Uuid::new_v4(), uid).await.unwrap();
        assert!(!deleted);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_enforces_user_isolation(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let habit = create(&pool, uid_a, "Oatmeal", "breakfast", "FREQ=DAILY")
            .await
            .unwrap();

        // uid_b cannot delete uid_a's habit
        let deleted = delete(&pool, habit.id, uid_b).await.unwrap();
        assert!(!deleted);

        // Record must still exist for uid_a
        let remaining = list(&pool, uid_a).await.unwrap();
        assert_eq!(remaining.len(), 1);
    }
}
