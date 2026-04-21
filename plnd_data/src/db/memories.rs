use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::UserMemory;

/// Create a new memory record for a user, returning the persisted record.
#[tracing::instrument(skip(pool), fields(table = "user_memories", op = "create_memory"))]
pub async fn create_memory(
    pool: &PgPool,
    user_id: Uuid,
    category: &str,
    content: &str,
    tags: Vec<String>,
) -> Result<UserMemory, DatabaseError> {
    sqlx::query_as::<_, UserMemory>(
        "INSERT INTO user_memories (user_id, category, content, tags)
         VALUES ($1, $2, $3, $4)
         RETURNING memory_id, user_id, category, content, tags, created_at, updated_at",
    )
    .bind(user_id)
    .bind(category)
    .bind(content)
    .bind(&tags)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Return all memories for a user, optionally filtered to the given categories.
/// When `categories` is empty every memory is returned; when non-empty only rows
/// whose `category` appears in the slice are included.
#[tracing::instrument(skip(pool), fields(table = "user_memories", op = "get_memories"))]
pub async fn get_memories(
    pool: &PgPool,
    user_id: Uuid,
    categories: &[&str],
) -> Result<Vec<UserMemory>, DatabaseError> {
    if categories.is_empty() {
        sqlx::query_as::<_, UserMemory>(
            "SELECT memory_id, user_id, category, content, tags, created_at, updated_at
             FROM user_memories
             WHERE user_id = $1
             ORDER BY created_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(DatabaseError::from)
    } else {
        let cats: Vec<String> = categories.iter().map(|s| s.to_string()).collect();
        sqlx::query_as::<_, UserMemory>(
            "SELECT memory_id, user_id, category, content, tags, created_at, updated_at
             FROM user_memories
             WHERE user_id = $1
               AND category = ANY($2)
             ORDER BY created_at DESC",
        )
        .bind(user_id)
        .bind(&cats)
        .fetch_all(pool)
        .await
        .map_err(DatabaseError::from)
    }
}

/// Update the `content` of an existing memory. Returns the updated record.
/// Returns `DatabaseError::NotFound` if `id` does not exist for `user_id`.
#[tracing::instrument(skip(pool), fields(table = "user_memories", op = "update_memory"))]
pub async fn update_memory(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    content: &str,
) -> Result<UserMemory, DatabaseError> {
    sqlx::query_as::<_, UserMemory>(
        "UPDATE user_memories
         SET content = $3, updated_at = NOW()
         WHERE memory_id = $1 AND user_id = $2
         RETURNING memory_id, user_id, category, content, tags, created_at, updated_at",
    )
    .bind(id)
    .bind(user_id)
    .bind(content)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Delete a memory. Succeeds silently if the record does not exist.
#[tracing::instrument(skip(pool), fields(table = "user_memories", op = "delete_memory"))]
pub async fn delete_memory(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<(), DatabaseError> {
    sqlx::query("DELETE FROM user_memories WHERE memory_id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(DatabaseError::from)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::users;

    /// Helper: create a throwaway user and return its UUID.
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
    // create_memory
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn create_returns_full_record(pool: PgPool) {
        let uid = new_user(&pool).await;
        let tags = vec!["tag-a".to_string(), "tag-b".to_string()];

        let mem = create_memory(&pool, uid, "food", "likes pasta", tags.clone())
            .await
            .expect("create_memory failed");

        assert_eq!(mem.user_id, uid);
        assert_eq!(mem.category, "food");
        assert_eq!(mem.content, "likes pasta");
        assert_eq!(mem.tags, tags);
    }

    // -----------------------------------------------------------------------
    // get_memories
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn get_memories_no_filter_returns_all(pool: PgPool) {
        let uid = new_user(&pool).await;
        create_memory(&pool, uid, "food", "a", vec![])
            .await
            .unwrap();
        create_memory(&pool, uid, "schedule", "b", vec![])
            .await
            .unwrap();

        let all = get_memories(&pool, uid, &[]).await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_memories_filters_by_single_category(pool: PgPool) {
        let uid = new_user(&pool).await;
        create_memory(&pool, uid, "food", "a", vec![])
            .await
            .unwrap();
        create_memory(&pool, uid, "schedule", "b", vec![])
            .await
            .unwrap();

        let food = get_memories(&pool, uid, &["food"]).await.unwrap();
        assert_eq!(food.len(), 1);
        assert_eq!(food[0].category, "food");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_memories_filters_by_multiple_categories(pool: PgPool) {
        let uid = new_user(&pool).await;
        create_memory(&pool, uid, "food", "a", vec![])
            .await
            .unwrap();
        create_memory(&pool, uid, "schedule", "b", vec![])
            .await
            .unwrap();
        create_memory(&pool, uid, "energy", "c", vec![])
            .await
            .unwrap();

        let result = get_memories(&pool, uid, &["food", "energy"]).await.unwrap();
        assert_eq!(result.len(), 2);
        let cats: Vec<&str> = result.iter().map(|m| m.category.as_str()).collect();
        assert!(cats.contains(&"food"));
        assert!(cats.contains(&"energy"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_memories_only_returns_own(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        create_memory(&pool, uid_a, "food", "user A memory", vec![])
            .await
            .unwrap();
        create_memory(&pool, uid_b, "food", "user B memory", vec![])
            .await
            .unwrap();

        let a_results = get_memories(&pool, uid_a, &[]).await.unwrap();
        assert_eq!(a_results.len(), 1);
        assert_eq!(a_results[0].user_id, uid_a);
    }

    // -----------------------------------------------------------------------
    // update_memory
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn update_changes_content(pool: PgPool) {
        let uid = new_user(&pool).await;
        let mem = create_memory(&pool, uid, "food", "original", vec![])
            .await
            .unwrap();

        let updated = update_memory(&pool, mem.memory_id, uid, "updated content")
            .await
            .unwrap();

        assert_eq!(updated.memory_id, mem.memory_id);
        assert_eq!(updated.content, "updated content");
        assert!(updated.updated_at >= mem.updated_at);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_nonexistent_returns_not_found(pool: PgPool) {
        let uid = new_user(&pool).await;
        let err = update_memory(&pool, Uuid::new_v4(), uid, "content")
            .await
            .unwrap_err();
        assert!(matches!(err, DatabaseError::NotFound));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_cannot_touch_other_users_memory(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let mem = create_memory(&pool, uid_a, "food", "original", vec![])
            .await
            .unwrap();

        let err = update_memory(&pool, mem.memory_id, uid_b, "hijacked")
            .await
            .unwrap_err();
        assert!(matches!(err, DatabaseError::NotFound));
    }

    // -----------------------------------------------------------------------
    // delete_memory
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_removes_record(pool: PgPool) {
        let uid = new_user(&pool).await;
        let mem = create_memory(&pool, uid, "food", "to delete", vec![])
            .await
            .unwrap();

        delete_memory(&pool, mem.memory_id, uid).await.unwrap();

        let remaining = get_memories(&pool, uid, &[]).await.unwrap();
        assert!(remaining.is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_is_idempotent(pool: PgPool) {
        let uid = new_user(&pool).await;
        let mem = create_memory(&pool, uid, "food", "to delete", vec![])
            .await
            .unwrap();

        delete_memory(&pool, mem.memory_id, uid).await.unwrap();
        delete_memory(&pool, mem.memory_id, uid).await.unwrap(); // second call must not error
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_cannot_touch_other_users_memory(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let mem = create_memory(&pool, uid_a, "food", "should survive", vec![])
            .await
            .unwrap();

        // uid_b's delete is a silent no-op — the record must still exist for uid_a
        delete_memory(&pool, mem.memory_id, uid_b).await.unwrap();

        let remaining = get_memories(&pool, uid_a, &[]).await.unwrap();
        assert_eq!(remaining.len(), 1);
    }
}
