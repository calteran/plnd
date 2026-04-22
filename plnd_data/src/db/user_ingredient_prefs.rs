use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::models::UserIngredientPref;

#[tracing::instrument(skip(pool), fields(table = "user_ingredient_prefs", op = "list"))]
pub async fn list(pool: &PgPool, user_id: Uuid) -> Result<Vec<UserIngredientPref>, DatabaseError> {
    sqlx::query_as::<_, UserIngredientPref>(
        "SELECT user_ingredient_pref_id, user_id, catalog_ingredient_id, \
         preference_score, notes, created_at, updated_at \
         FROM user_ingredient_prefs WHERE user_id = $1 ORDER BY created_at",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "user_ingredient_prefs", op = "upsert"))]
pub async fn upsert(
    pool: &PgPool,
    user_id: Uuid,
    catalog_ingredient_id: Uuid,
    preference_score: i16,
    notes: Option<&str>,
) -> Result<UserIngredientPref, DatabaseError> {
    sqlx::query_as::<_, UserIngredientPref>(
        r#"
        INSERT INTO user_ingredient_prefs (user_id, catalog_ingredient_id, preference_score, notes)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, catalog_ingredient_id) DO UPDATE
            SET preference_score = EXCLUDED.preference_score,
                notes             = EXCLUDED.notes,
                updated_at        = NOW()
        RETURNING user_ingredient_pref_id, user_id, catalog_ingredient_id,
                  preference_score, notes, created_at, updated_at
        "#,
    )
    .bind(user_id)
    .bind(catalog_ingredient_id)
    .bind(preference_score)
    .bind(notes)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
}

#[tracing::instrument(skip(pool), fields(table = "user_ingredient_prefs", op = "delete"))]
pub async fn delete(
    pool: &PgPool,
    user_id: Uuid,
    catalog_ingredient_id: Uuid,
) -> Result<bool, DatabaseError> {
    sqlx::query(
        "DELETE FROM user_ingredient_prefs WHERE user_id = $1 AND catalog_ingredient_id = $2",
    )
    .bind(user_id)
    .bind(catalog_ingredient_id)
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
    use crate::db::{
        catalog_ingest::{ingest_ingredient, IngestIngredientParams},
        users,
    };

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

    async fn new_ingredient(pool: &PgPool) -> Uuid {
        ingest_ingredient(
            pool,
            IngestIngredientParams {
                external_source: "test",
                external_id: &Uuid::new_v4().to_string(),
                name: "Test Ingredient",
                description: None,
                serving_size_g: None,
                nutrition: None,
                allergens: &[],
                occasion_tags: &[],
            },
        )
        .await
        .expect("failed to create test ingredient")
    }

    // -----------------------------------------------------------------------
    // upsert
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn upsert_creates_new_pref(pool: PgPool) {
        let uid = new_user(&pool).await;
        let iid = new_ingredient(&pool).await;

        let pref = upsert(&pool, uid, iid, -2, Some("avoid completely"))
            .await
            .expect("upsert failed");

        assert_eq!(pref.user_id, uid);
        assert_eq!(pref.catalog_ingredient_id, iid);
        assert_eq!(pref.preference_score, -2);
        assert_eq!(pref.notes.as_deref(), Some("avoid completely"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn upsert_updates_existing_pref(pool: PgPool) {
        let uid = new_user(&pool).await;
        let iid = new_ingredient(&pool).await;

        let first = upsert(&pool, uid, iid, -2, Some("first note"))
            .await
            .expect("first upsert failed");

        let second = upsert(&pool, uid, iid, 1, Some("updated note"))
            .await
            .expect("second upsert failed");

        assert_eq!(
            second.user_ingredient_pref_id,
            first.user_ingredient_pref_id
        );
        assert_eq!(second.preference_score, 1);
        assert_eq!(second.notes.as_deref(), Some("updated note"));
        assert!(second.updated_at >= first.updated_at);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn upsert_rejects_out_of_range_score(pool: PgPool) {
        let uid = new_user(&pool).await;
        let iid = new_ingredient(&pool).await;

        // score 3 violates the CHECK constraint
        let result = upsert(&pool, uid, iid, 3, None).await;
        assert!(result.is_err(), "score 3 should violate CHECK constraint");
    }

    // -----------------------------------------------------------------------
    // list
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn list_returns_user_prefs(pool: PgPool) {
        let uid = new_user(&pool).await;
        let iid_a = new_ingredient(&pool).await;
        let iid_b = new_ingredient(&pool).await;

        upsert(&pool, uid, iid_a, -2, None).await.unwrap();
        upsert(&pool, uid, iid_b, 1, None).await.unwrap();

        let prefs = list(&pool, uid).await.unwrap();
        assert_eq!(prefs.len(), 2);
        assert!(prefs.iter().all(|p| p.user_id == uid));
    }

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_true(pool: PgPool) {
        let uid = new_user(&pool).await;
        let iid = new_ingredient(&pool).await;

        upsert(&pool, uid, iid, -2, None).await.unwrap();

        let deleted = delete(&pool, uid, iid).await.unwrap();
        assert!(deleted);

        let remaining = list(&pool, uid).await.unwrap();
        assert!(remaining.is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_unknown_returns_false(pool: PgPool) {
        let uid = new_user(&pool).await;
        let unknown_iid = Uuid::new_v4();

        let deleted = delete(&pool, uid, unknown_iid).await.unwrap();
        assert!(!deleted);
    }
}
