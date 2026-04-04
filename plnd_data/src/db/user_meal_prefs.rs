use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::error::DatabaseError;
use super::models::UserMealPrefDetail;

/// Single SQL fragment for selecting a UserMealPrefDetail row.
/// Used in both list and get queries.
const PREF_DETAIL_SELECT: &str = r#"
    SELECT
        p.user_meal_pref_id,
        p.user_id,
        p.catalog_meal_id,
        p.user_meal_id,
        p.rating,
        p.is_safe_food,
        p.is_blocked,
        p.notes,
        p.created_at,
        p.updated_at,
        COALESCE(um.name, cm.name, '')     AS name,
        CASE WHEN p.user_meal_id IS NOT NULL THEN 'personal' ELSE 'catalog' END AS source,
        (p.user_meal_id IS NOT NULL)       AS has_personal_recipe,
        cm.external_source                 AS origin_external_source
    FROM user_meal_prefs p
    LEFT JOIN catalog_meals cm ON cm.meal_id = p.catalog_meal_id
    LEFT JOIN user_meals    um ON um.user_meal_id = p.user_meal_id
"#;

#[tracing::instrument(skip(pool), fields(table = "user_meal_prefs", op = "list"))]
pub async fn list(pool: &PgPool, user_id: Uuid) -> Result<Vec<UserMealPrefDetail>, DatabaseError> {
    let sql = format!(
        "{} WHERE p.user_id = $1 ORDER BY p.created_at",
        PREF_DETAIL_SELECT
    );
    sqlx::query_as::<_, UserMealPrefDetail>(&sql)
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

#[tracing::instrument(skip(pool), fields(table = "user_meal_prefs", op = "get"))]
pub async fn get(
    pool: &PgPool,
    user_id: Uuid,
    pref_id: Uuid,
) -> Result<Option<UserMealPrefDetail>, DatabaseError> {
    let sql = format!(
        "{} WHERE p.user_id = $1 AND p.user_meal_pref_id = $2",
        PREF_DETAIL_SELECT
    );
    sqlx::query_as::<_, UserMealPrefDetail>(&sql)
        .bind(user_id)
        .bind(pref_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

#[tracing::instrument(
    skip(pool),
    fields(table = "user_meal_prefs", op = "create_from_catalog")
)]
pub async fn create_from_catalog(
    pool: &PgPool,
    user_id: Uuid,
    catalog_meal_id: Uuid,
) -> Result<UserMealPrefDetail, DatabaseError> {
    // Insert the pref record. If duplicate, the UNIQUE(user_id, catalog_meal_id) constraint
    // will return a unique violation error — the caller maps this to 409.
    let (pref_id,) = sqlx::query_as::<_, (Uuid,)>(
        "INSERT INTO user_meal_prefs (user_id, catalog_meal_id) VALUES ($1, $2) RETURNING user_meal_pref_id",
    )
    .bind(user_id)
    .bind(catalog_meal_id)
    .fetch_one(pool)
    .await?;

    get(pool, user_id, pref_id)
        .await
        .map(|opt| opt.expect("just inserted"))
}

#[tracing::instrument(
    skip(pool),
    fields(table = "user_meal_prefs", op = "create_from_scratch")
)]
pub async fn create_from_scratch(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    description: Option<&str>,
) -> Result<UserMealPrefDetail, DatabaseError> {
    let mut tx = pool.begin().await?;

    // Create personal meal first
    let (user_meal_id,) = sqlx::query_as::<_, (Uuid,)>(
        "INSERT INTO user_meals (user_id, name, description, servings) \
         VALUES ($1, $2, $3, 1) RETURNING user_meal_id",
    )
    .bind(user_id)
    .bind(name)
    .bind(description)
    .fetch_one(&mut *tx)
    .await?;

    // Create pref record pointing to personal meal
    let (pref_id,) = sqlx::query_as::<_, (Uuid,)>(
        "INSERT INTO user_meal_prefs (user_id, user_meal_id) VALUES ($1, $2) RETURNING user_meal_pref_id",
    )
    .bind(user_id)
    .bind(user_meal_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    get(pool, user_id, pref_id)
        .await
        .map(|opt| opt.expect("just inserted"))
}

#[tracing::instrument(skip(pool), fields(table = "user_meal_prefs", op = "update_metadata"))]
pub async fn update_metadata(
    pool: &PgPool,
    user_id: Uuid,
    pref_id: Uuid,
    rating: Option<Option<i16>>,
    is_safe_food: Option<bool>,
    is_blocked: Option<bool>,
    notes: Option<Option<String>>,
) -> Result<Option<UserMealPrefDetail>, DatabaseError> {
    let rows = sqlx::query(
        r#"
        UPDATE user_meal_prefs SET
            rating       = COALESCE($3, rating),
            is_safe_food = COALESCE($4, is_safe_food),
            is_blocked   = COALESCE($5, is_blocked),
            notes        = CASE WHEN $6 THEN $7 ELSE notes END,
            updated_at   = NOW()
        WHERE user_id = $1 AND user_meal_pref_id = $2
        "#,
    )
    .bind(user_id)
    .bind(pref_id)
    .bind(rating.flatten()) // $3: new rating value (or NULL to keep old)
    .bind(is_safe_food) // $4
    .bind(is_blocked) // $5
    .bind(notes.is_some()) // $6: whether notes field was provided
    .bind(notes.flatten()) // $7: new notes value
    .execute(pool)
    .await?;

    if rows.rows_affected() == 0 {
        return Ok(None);
    }
    get(pool, user_id, pref_id).await
}

/// Fork a catalog meal into user_meals (if not already forked), then apply update.
/// Runs in a transaction. If pref already has a user_meal_id, skips the fork step.
#[tracing::instrument(
    skip(pool),
    fields(table = "user_meal_prefs", op = "fork_and_update_recipe")
)]
pub async fn fork_and_update_recipe(
    pool: &PgPool,
    user_id: Uuid,
    pref_id: Uuid,
    name: Option<&str>,
    description: Option<&str>,
) -> Result<Option<UserMealPrefDetail>, DatabaseError> {
    let mut tx = pool.begin().await?;

    // Get current pref (lock row)
    let row = sqlx::query_as::<_, (Uuid, Option<Uuid>, Option<Uuid>)>(
        "SELECT user_meal_pref_id, catalog_meal_id, user_meal_id \
         FROM user_meal_prefs WHERE user_id = $1 AND user_meal_pref_id = $2 FOR UPDATE",
    )
    .bind(user_id)
    .bind(pref_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((_pref_id, catalog_meal_id, current_user_meal_id)) = row else {
        return Ok(None);
    };

    let user_meal_id = if let Some(uid) = current_user_meal_id {
        uid
    } else {
        // Fork: copy catalog meal into user_meals
        let catalog_meal_id = catalog_meal_id.expect("pref must have catalog or user meal");
        let (new_um_id,) = sqlx::query_as::<_, (Uuid,)>(
            r#"
            INSERT INTO user_meals
                (user_id, catalog_meal_id, name, description, servings,
                 allergens, allergens_overridden, occasion_tags, tags,
                 nutrition, nutrition_overridden)
            SELECT $1, meal_id, name, description, servings,
                   allergens, allergens_overridden, occasion_tags, tags,
                   nutrition, nutrition_overridden
            FROM catalog_meals WHERE meal_id = $2
            RETURNING user_meal_id
            "#,
        )
        .bind(user_id)
        .bind(catalog_meal_id)
        .fetch_one(&mut *tx)
        .await?;

        // Update pref to point to the new personal meal
        sqlx::query(
            "UPDATE user_meal_prefs SET user_meal_id = $1, updated_at = NOW() \
             WHERE user_meal_pref_id = $2",
        )
        .bind(new_um_id)
        .bind(pref_id)
        .execute(&mut *tx)
        .await?;

        new_um_id
    };

    // Apply update to user_meals
    sqlx::query(
        r#"
        UPDATE user_meals SET
            name        = COALESCE($3, name),
            description = COALESCE($4, description),
            updated_at  = NOW()
        WHERE user_meal_id = $1 AND user_id = $2
        "#,
    )
    .bind(user_meal_id)
    .bind(user_id)
    .bind(name)
    .bind(description)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    get(pool, user_id, pref_id).await
}

#[tracing::instrument(skip(pool), fields(table = "user_meal_prefs", op = "delete"))]
pub async fn delete(pool: &PgPool, user_id: Uuid, pref_id: Uuid) -> Result<bool, DatabaseError> {
    // Also delete the personal user_meal (and its dishes) if it exists.
    let mut tx = pool.begin().await?;

    let row = sqlx::query_as::<_, (Option<Uuid>,)>(
        "DELETE FROM user_meal_prefs WHERE user_id = $1 AND user_meal_pref_id = $2 RETURNING user_meal_id",
    )
    .bind(user_id)
    .bind(pref_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((user_meal_id,)) = row else {
        return Ok(false);
    };

    // If a personal meal exists, delete its dish associations then the meal itself
    if let Some(um_id) = user_meal_id {
        sqlx::query("DELETE FROM user_meal_dishes WHERE user_meal_id = $1")
            .bind(um_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query("DELETE FROM user_meals WHERE user_meal_id = $1 AND user_id = $2")
            .bind(um_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(true)
}

pub struct AddDishParams {
    pub catalog_dish_id: Option<Uuid>,
    pub user_dish_id: Option<Uuid>,
    pub dish_servings: rust_decimal::Decimal,
    pub notes: Option<String>,
    pub sort_order: i16,
}

#[tracing::instrument(skip(pool, params), fields(table = "user_meal_prefs", op = "add_dish"))]
pub async fn add_dish(
    pool: &PgPool,
    user_id: Uuid,
    pref_id: Uuid,
    params: AddDishParams,
) -> Result<Option<UserMealPrefDetail>, DatabaseError> {
    let mut tx = pool.begin().await?;

    let user_meal_id = ensure_forked(&mut tx, user_id, pref_id).await?;
    let Some(user_meal_id) = user_meal_id else {
        return Ok(None);
    };

    sqlx::query(
        r#"
        INSERT INTO user_meal_dishes
            (user_meal_id, catalog_dish_id, user_dish_id, dish_servings, notes, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(user_meal_id)
    .bind(params.catalog_dish_id)
    .bind(params.user_dish_id)
    .bind(params.dish_servings)
    .bind(params.notes)
    .bind(params.sort_order)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    get(pool, user_id, pref_id).await
}

#[tracing::instrument(skip(pool), fields(table = "user_meal_prefs", op = "remove_dish"))]
pub async fn remove_dish(
    pool: &PgPool,
    user_id: Uuid,
    pref_id: Uuid,
    meal_dish_id: Uuid,
) -> Result<Option<bool>, DatabaseError> {
    let mut tx = pool.begin().await?;

    let user_meal_id = ensure_forked(&mut tx, user_id, pref_id).await?;
    let Some(user_meal_id) = user_meal_id else {
        return Ok(None); // pref not found
    };

    let result = sqlx::query(
        "DELETE FROM user_meal_dishes WHERE user_meal_dish_id = $1 AND user_meal_id = $2",
    )
    .bind(meal_dish_id)
    .bind(user_meal_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Some(result.rows_affected() > 0))
}

/// Ensure a personal user_meal exists for this pref, forking from catalog if needed.
/// Returns Some(user_meal_id) if pref found, None if pref not found.
async fn ensure_forked(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    pref_id: Uuid,
) -> Result<Option<Uuid>, DatabaseError> {
    let row = sqlx::query_as::<_, (Option<Uuid>, Option<Uuid>)>(
        "SELECT user_meal_id, catalog_meal_id FROM user_meal_prefs \
         WHERE user_id = $1 AND user_meal_pref_id = $2 FOR UPDATE",
    )
    .bind(user_id)
    .bind(pref_id)
    .fetch_optional(&mut **tx)
    .await?;

    let Some((current_user_meal_id, catalog_meal_id)) = row else {
        return Ok(None);
    };

    if let Some(uid) = current_user_meal_id {
        return Ok(Some(uid));
    }

    // Fork from catalog
    let catalog_id = catalog_meal_id.expect("CHECK constraint ensures one is set");
    let (new_um_id,) = sqlx::query_as::<_, (Uuid,)>(
        r#"
        INSERT INTO user_meals
            (user_id, catalog_meal_id, name, description, servings,
             allergens, allergens_overridden, occasion_tags, tags,
             nutrition, nutrition_overridden)
        SELECT $1, meal_id, name, description, servings,
               allergens, allergens_overridden, occasion_tags, tags,
               nutrition, nutrition_overridden
        FROM catalog_meals WHERE meal_id = $2
        RETURNING user_meal_id
        "#,
    )
    .bind(user_id)
    .bind(catalog_id)
    .fetch_one(&mut **tx)
    .await?;

    sqlx::query(
        "UPDATE user_meal_prefs SET user_meal_id = $1, updated_at = NOW() \
         WHERE user_meal_pref_id = $2",
    )
    .bind(new_um_id)
    .bind(pref_id)
    .execute(&mut **tx)
    .await?;

    Ok(Some(new_um_id))
}

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
    // create_from_scratch
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn create_from_scratch_returns_detail(pool: PgPool) {
        let uid = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid, "Test Meal", Some("A description"))
            .await
            .expect("create_from_scratch failed");

        assert_eq!(pref.user_id, uid);
        assert_eq!(pref.name, "Test Meal");
        assert_eq!(pref.source, "personal");
        assert!(pref.has_personal_recipe);
        assert!(pref.user_meal_id.is_some());
        assert!(pref.catalog_meal_id.is_none());
    }

    // -----------------------------------------------------------------------
    // list
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn list_returns_created_meal(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid_a, "Listed Meal", None)
            .await
            .unwrap();
        // Create a pref for a second user — must not appear in uid_a's list
        create_from_scratch(&pool, uid_b, "Other User Meal", None)
            .await
            .unwrap();

        let results = list(&pool, uid_a).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].user_meal_pref_id, pref.user_meal_pref_id);
    }

    // -----------------------------------------------------------------------
    // get
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn get_returns_meal(pool: PgPool) {
        let uid = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid, "Get Meal", None)
            .await
            .unwrap();

        let found = get(&pool, uid, pref.user_meal_pref_id).await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().user_meal_pref_id, pref.user_meal_pref_id);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_returns_none_for_wrong_user(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid_a, "Private Meal", None)
            .await
            .unwrap();

        let found = get(&pool, uid_b, pref.user_meal_pref_id).await.unwrap();
        assert!(found.is_none());
    }

    // -----------------------------------------------------------------------
    // update_metadata
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn update_metadata_sets_rating_and_flags(pool: PgPool) {
        let uid = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid, "Rated Meal", None)
            .await
            .unwrap();

        let updated = update_metadata(
            &pool,
            uid,
            pref.user_meal_pref_id,
            Some(Some(4)),
            Some(true),
            Some(false),
            Some(Some("great meal".to_string())),
        )
        .await
        .unwrap();

        let updated = updated.expect("update returned None");
        assert_eq!(updated.rating, Some(4));
        assert!(updated.is_safe_food);
        assert!(!updated.is_blocked);
        assert_eq!(updated.notes.as_deref(), Some("great meal"));
    }

    // -----------------------------------------------------------------------
    // fork_and_update_recipe
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn fork_and_update_recipe_returns_updated(pool: PgPool) {
        let uid = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid, "Original Name", None)
            .await
            .unwrap();

        let updated = fork_and_update_recipe(
            &pool,
            uid,
            pref.user_meal_pref_id,
            Some("Updated Name"),
            Some("New description"),
        )
        .await
        .unwrap();

        let updated = updated.expect("fork_and_update_recipe returned None");
        assert_eq!(updated.name, "Updated Name");
        assert!(updated.has_personal_recipe);
        // user_meal_id must not change (no new fork was needed)
        assert_eq!(updated.user_meal_id, pref.user_meal_id);

        // Verify description was persisted in user_meals
        let (description,): (Option<String>,) =
            sqlx::query_as("SELECT description FROM user_meals WHERE user_meal_id = $1")
                .bind(updated.user_meal_id.unwrap())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(description.as_deref(), Some("New description"));
    }

    // -----------------------------------------------------------------------
    // add_dish / remove_dish
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn add_dish_links_dish_pref(pool: PgPool) {
        use crate::db::user_dish_prefs;
        use rust_decimal::Decimal;

        let uid = new_user(&pool).await;
        let meal_pref = create_from_scratch(&pool, uid, "Meal With Dish", None)
            .await
            .unwrap();
        let dish_pref =
            user_dish_prefs::create_from_scratch(&pool, uid, "Side Dish", None, None, None)
                .await
                .unwrap();

        let params = AddDishParams {
            catalog_dish_id: None,
            user_dish_id: dish_pref.user_dish_id,
            dish_servings: Decimal::new(1, 0),
            notes: None,
            sort_order: 0,
        };

        let result = add_dish(&pool, uid, meal_pref.user_meal_pref_id, params)
            .await
            .unwrap();
        assert!(result.is_some());

        let (linked_user_dish_id,): (Option<Uuid>,) =
            sqlx::query_as("SELECT user_dish_id FROM user_meal_dishes WHERE user_meal_id = $1")
                .bind(meal_pref.user_meal_id.unwrap())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(linked_user_dish_id, dish_pref.user_dish_id);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn remove_dish_unlinks(pool: PgPool) {
        use crate::db::user_dish_prefs;
        use rust_decimal::Decimal;

        let uid = new_user(&pool).await;
        let meal_pref = create_from_scratch(&pool, uid, "Meal To Remove Dish", None)
            .await
            .unwrap();
        let dish_pref =
            user_dish_prefs::create_from_scratch(&pool, uid, "Linked Dish", None, None, None)
                .await
                .unwrap();

        let params = AddDishParams {
            catalog_dish_id: None,
            user_dish_id: dish_pref.user_dish_id,
            dish_servings: Decimal::new(1, 0),
            notes: None,
            sort_order: 0,
        };
        add_dish(&pool, uid, meal_pref.user_meal_pref_id, params)
            .await
            .unwrap();

        let (meal_dish_id,): (Uuid,) = sqlx::query_as(
            "SELECT user_meal_dish_id FROM user_meal_dishes WHERE user_meal_id = $1",
        )
        .bind(meal_pref.user_meal_id.unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();

        let removed = remove_dish(&pool, uid, meal_pref.user_meal_pref_id, meal_dish_id)
            .await
            .unwrap();
        assert_eq!(removed, Some(true));

        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM user_meal_dishes WHERE user_meal_id = $1")
                .bind(meal_pref.user_meal_id.unwrap())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count.0, 0);
    }

    // -----------------------------------------------------------------------
    // delete
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_returns_true(pool: PgPool) {
        let uid = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid, "Meal To Delete", None)
            .await
            .unwrap();

        let user_meal_id = pref.user_meal_id.unwrap();
        let deleted = delete(&pool, uid, pref.user_meal_pref_id).await.unwrap();
        assert!(deleted);

        let found = get(&pool, uid, pref.user_meal_pref_id).await.unwrap();
        assert!(found.is_none());

        // The personal user_meal must also be deleted (cascade)
        let meal_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM user_meals WHERE user_meal_id = $1")
                .bind(user_meal_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(meal_count.0, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_wrong_user_returns_false(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid_a, "Meal Not Yours", None)
            .await
            .unwrap();

        let deleted = delete(&pool, uid_b, pref.user_meal_pref_id).await.unwrap();
        assert!(!deleted);
    }
}
