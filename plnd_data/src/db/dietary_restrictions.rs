use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::DietaryRestriction;

/// List all dietary restrictions for a user, ordered by type then name.
#[tracing::instrument(skip(pool), fields(table = "dietary_restrictions", op = "list"))]
pub async fn list(pool: &PgPool, user_id: Uuid) -> Result<Vec<DietaryRestriction>, DatabaseError> {
    sqlx::query_as::<_, DietaryRestriction>(
        "SELECT restriction_id, user_id, restriction_type, name, notes, created_at, updated_at
         FROM dietary_restrictions
         WHERE user_id = $1
         ORDER BY restriction_type, name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Insert a new dietary restriction, returning the created record.
#[tracing::instrument(skip(pool), fields(table = "dietary_restrictions", op = "create"))]
pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    restriction_type: &str,
    name: &str,
    notes: Option<&str>,
) -> Result<DietaryRestriction, DatabaseError> {
    sqlx::query_as::<_, DietaryRestriction>(
        "INSERT INTO dietary_restrictions (user_id, restriction_type, name, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING restriction_id, user_id, restriction_type, name, notes, created_at, updated_at",
    )
    .bind(user_id)
    .bind(restriction_type)
    .bind(name)
    .bind(notes)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Update the notes on an existing restriction. Returns None if the restriction was not found
/// or does not belong to the given user.
#[tracing::instrument(skip(pool), fields(table = "dietary_restrictions", op = "update"))]
pub async fn update(
    pool: &PgPool,
    restriction_id: Uuid,
    user_id: Uuid,
    notes: Option<&str>,
) -> Result<Option<DietaryRestriction>, DatabaseError> {
    sqlx::query_as::<_, DietaryRestriction>(
        "UPDATE dietary_restrictions
         SET notes = COALESCE($3, notes),
             updated_at = NOW()
         WHERE restriction_id = $1 AND user_id = $2
         RETURNING restriction_id, user_id, restriction_type, name, notes, created_at, updated_at",
    )
    .bind(restriction_id)
    .bind(user_id)
    .bind(notes)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::from)
}

/// Delete a restriction. Returns true if a row was deleted, false if not found.
#[tracing::instrument(skip(pool), fields(table = "dietary_restrictions", op = "delete"))]
pub async fn delete(
    pool: &PgPool,
    restriction_id: Uuid,
    user_id: Uuid,
) -> Result<bool, DatabaseError> {
    sqlx::query("DELETE FROM dietary_restrictions WHERE restriction_id = $1 AND user_id = $2")
        .bind(restriction_id)
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
    async fn create_returns_restriction(pool: PgPool) {
        let uid = new_user(&pool).await;

        let r = create(&pool, uid, "allergy", "peanuts", Some("anaphylactic"))
            .await
            .expect("create failed");

        assert_eq!(r.user_id, uid);
        assert_eq!(r.restriction_type, "allergy");
        assert_eq!(r.name, "peanuts");
        assert_eq!(r.notes.as_deref(), Some("anaphylactic"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_returns_created_restrictions(pool: PgPool) {
        let uid = new_user(&pool).await;

        create(&pool, uid, "allergy", "peanuts", None)
            .await
            .unwrap();
        create(&pool, uid, "intolerance", "lactose", None)
            .await
            .unwrap();

        let result = list(&pool, uid).await.unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|r| r.user_id == uid));
    }

    // -----------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn update_notes_returns_updated(pool: PgPool) {
        let uid = new_user(&pool).await;
        let r = create(&pool, uid, "allergy", "shellfish", None)
            .await
            .unwrap();

        let updated = update(&pool, r.restriction_id, uid, Some("severe reaction"))
            .await
            .unwrap()
            .expect("expected Some but got None");

        assert_eq!(updated.restriction_id, r.restriction_id);
        assert_eq!(updated.notes.as_deref(), Some("severe reaction"));
        assert!(updated.updated_at >= r.updated_at);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_with_none_notes_preserves_existing(pool: PgPool) {
        // COALESCE($3, notes) means passing None is a no-op — it cannot clear
        // existing notes to NULL. This test documents that contract explicitly.
        let uid = new_user(&pool).await;
        let r = create(&pool, uid, "allergy", "shellfish", Some("existing note"))
            .await
            .unwrap();

        let after = update(&pool, r.restriction_id, uid, None)
            .await
            .unwrap()
            .expect("expected Some but got None");

        assert_eq!(after.notes.as_deref(), Some("existing note"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_returns_none_for_wrong_user(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let r = create(&pool, uid_a, "allergy", "shellfish", None)
            .await
            .unwrap();

        let result = update(&pool, r.restriction_id, uid_b, Some("hijacked"))
            .await
            .unwrap();

        assert!(result.is_none());
    }

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_true(pool: PgPool) {
        let uid = new_user(&pool).await;
        let r = create(&pool, uid, "allergy", "peanuts", None)
            .await
            .unwrap();

        let deleted = delete(&pool, r.restriction_id, uid).await.unwrap();
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
        let r = create(&pool, uid_a, "allergy", "peanuts", None)
            .await
            .unwrap();

        // uid_b cannot delete uid_a's restriction
        let deleted = delete(&pool, r.restriction_id, uid_b).await.unwrap();
        assert!(!deleted);

        // Record must still exist for uid_a
        let remaining = list(&pool, uid_a).await.unwrap();
        assert_eq!(remaining.len(), 1);
    }
}
