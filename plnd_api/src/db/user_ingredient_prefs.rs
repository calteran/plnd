use sqlx::PgPool;
use uuid::Uuid;

use super::models::UserIngredientPref;

pub async fn list(pool: &PgPool, user_id: Uuid) -> Result<Vec<UserIngredientPref>, sqlx::Error> {
    sqlx::query_as::<_, UserIngredientPref>(
        "SELECT user_ingredient_pref_id, user_id, catalog_ingredient_id, \
         is_blocked, notes, created_at, updated_at \
         FROM user_ingredient_prefs WHERE user_id = $1 ORDER BY created_at",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn upsert(
    pool: &PgPool,
    user_id: Uuid,
    catalog_ingredient_id: Uuid,
    is_blocked: bool,
    notes: Option<&str>,
) -> Result<UserIngredientPref, sqlx::Error> {
    sqlx::query_as::<_, UserIngredientPref>(
        r#"
        INSERT INTO user_ingredient_prefs (user_id, catalog_ingredient_id, is_blocked, notes)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, catalog_ingredient_id) DO UPDATE
            SET is_blocked = EXCLUDED.is_blocked,
                notes      = EXCLUDED.notes,
                updated_at = NOW()
        RETURNING user_ingredient_pref_id, user_id, catalog_ingredient_id,
                  is_blocked, notes, created_at, updated_at
        "#,
    )
    .bind(user_id)
    .bind(catalog_ingredient_id)
    .bind(is_blocked)
    .bind(notes)
    .fetch_one(pool)
    .await
}

pub async fn delete(
    pool: &PgPool,
    user_id: Uuid,
    catalog_ingredient_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM user_ingredient_prefs WHERE user_id = $1 AND catalog_ingredient_id = $2",
    )
    .bind(user_id)
    .bind(catalog_ingredient_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}
