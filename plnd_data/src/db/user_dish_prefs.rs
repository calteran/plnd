use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::error::DatabaseError;
use crate::models::{AddIngredientParams, UserDishPrefDetail};

/// Single SQL fragment for selecting a UserDishPrefDetail row.
/// Used in both list and get queries.
const PREF_DETAIL_SELECT: &str = r#"
    SELECT
        p.user_dish_pref_id,
        p.user_id,
        p.catalog_dish_id,
        p.user_dish_id,
        p.rating,
        p.is_safe_food,
        p.is_blocked,
        p.notes,
        p.created_at,
        p.updated_at,
        COALESCE(ud.name, cd.name, '')     AS name,
        CASE WHEN p.user_dish_id IS NOT NULL THEN 'personal' ELSE 'catalog' END AS source,
        (p.user_dish_id IS NOT NULL)       AS has_personal_recipe,
        cd.external_source                 AS origin_external_source
    FROM user_dish_prefs p
    LEFT JOIN catalog_dishes cd ON cd.dish_id = p.catalog_dish_id
    LEFT JOIN user_dishes    ud ON ud.user_dish_id = p.user_dish_id
"#;

#[tracing::instrument(skip(pool), fields(table = "user_dish_prefs", op = "list"))]
pub async fn list(pool: &PgPool, user_id: Uuid) -> Result<Vec<UserDishPrefDetail>, DatabaseError> {
    let sql = format!(
        "{} WHERE p.user_id = $1 ORDER BY p.created_at",
        PREF_DETAIL_SELECT
    );
    sqlx::query_as::<_, UserDishPrefDetail>(&sql)
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

#[tracing::instrument(skip(pool), fields(table = "user_dish_prefs", op = "get"))]
pub async fn get(
    pool: &PgPool,
    user_id: Uuid,
    pref_id: Uuid,
) -> Result<Option<UserDishPrefDetail>, DatabaseError> {
    let sql = format!(
        "{} WHERE p.user_id = $1 AND p.user_dish_pref_id = $2",
        PREF_DETAIL_SELECT
    );
    sqlx::query_as::<_, UserDishPrefDetail>(&sql)
        .bind(user_id)
        .bind(pref_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

#[tracing::instrument(
    skip(pool),
    fields(table = "user_dish_prefs", op = "create_from_catalog")
)]
pub async fn create_from_catalog(
    pool: &PgPool,
    user_id: Uuid,
    catalog_dish_id: Uuid,
) -> Result<UserDishPrefDetail, DatabaseError> {
    // Insert the pref record. If duplicate, the UNIQUE(user_id, catalog_dish_id) constraint
    // will return a unique violation error — the caller maps this to 409.
    let (pref_id,) = sqlx::query_as::<_, (Uuid,)>(
        "INSERT INTO user_dish_prefs (user_id, catalog_dish_id) VALUES ($1, $2) RETURNING user_dish_pref_id",
    )
    .bind(user_id)
    .bind(catalog_dish_id)
    .fetch_one(pool)
    .await?;

    get(pool, user_id, pref_id)
        .await
        .map(|opt| opt.expect("just inserted"))
}

#[tracing::instrument(
    skip(pool),
    fields(table = "user_dish_prefs", op = "create_from_scratch")
)]
pub async fn create_from_scratch(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    instructions: Option<&str>,
    prep_time_minutes: Option<i32>,
    cook_time_minutes: Option<i32>,
) -> Result<UserDishPrefDetail, DatabaseError> {
    let mut tx = pool.begin().await?;

    // Create personal dish first
    let (user_dish_id,) = sqlx::query_as::<_, (Uuid,)>(
        "INSERT INTO user_dishes (user_id, name, instructions, prep_time_minutes, cook_time_minutes, servings) \
         VALUES ($1, $2, $3, $4, $5, 1) RETURNING user_dish_id",
    )
    .bind(user_id)
    .bind(name)
    .bind(instructions)
    .bind(prep_time_minutes)
    .bind(cook_time_minutes)
    .fetch_one(&mut *tx)
    .await?;

    // Create pref record pointing to personal dish
    let (pref_id,) = sqlx::query_as::<_, (Uuid,)>(
        "INSERT INTO user_dish_prefs (user_id, user_dish_id) VALUES ($1, $2) RETURNING user_dish_pref_id",
    )
    .bind(user_id)
    .bind(user_dish_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    get(pool, user_id, pref_id)
        .await
        .map(|opt| opt.expect("just inserted"))
}

#[tracing::instrument(skip(pool), fields(table = "user_dish_prefs", op = "update_metadata"))]
pub async fn update_metadata(
    pool: &PgPool,
    user_id: Uuid,
    pref_id: Uuid,
    rating: Option<Option<i16>>,
    is_safe_food: Option<bool>,
    is_blocked: Option<bool>,
    notes: Option<Option<String>>,
) -> Result<Option<UserDishPrefDetail>, DatabaseError> {
    let rows = sqlx::query(
        r#"
        UPDATE user_dish_prefs SET
            rating       = COALESCE($3, rating),
            is_safe_food = COALESCE($4, is_safe_food),
            is_blocked   = COALESCE($5, is_blocked),
            notes        = CASE WHEN $6 THEN $7 ELSE notes END,
            updated_at   = NOW()
        WHERE user_id = $1 AND user_dish_pref_id = $2
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

/// Fork a catalog dish into user_dishes (if not already forked), then apply recipe update.
/// Runs in a transaction. If pref already has a user_dish_id, skips the fork step.
#[tracing::instrument(
    skip(pool),
    fields(table = "user_dish_prefs", op = "fork_and_update_recipe")
)]
pub async fn fork_and_update_recipe(
    pool: &PgPool,
    user_id: Uuid,
    pref_id: Uuid,
    name: Option<&str>,
    instructions: Option<&str>,
    prep_time_minutes: Option<i32>,
    cook_time_minutes: Option<i32>,
) -> Result<Option<UserDishPrefDetail>, DatabaseError> {
    let mut tx = pool.begin().await?;

    // Get current pref (lock row)
    let row = sqlx::query_as::<_, (Uuid, Option<Uuid>, Option<Uuid>)>(
        "SELECT user_dish_pref_id, catalog_dish_id, user_dish_id \
         FROM user_dish_prefs WHERE user_id = $1 AND user_dish_pref_id = $2 FOR UPDATE",
    )
    .bind(user_id)
    .bind(pref_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((_pref_id, catalog_dish_id, current_user_dish_id)) = row else {
        return Ok(None);
    };

    let user_dish_id = if let Some(uid) = current_user_dish_id {
        uid
    } else {
        // Fork: copy catalog dish into user_dishes
        let catalog_dish_id = catalog_dish_id.expect("pref must have catalog or user dish");
        let (new_ud_id,) = sqlx::query_as::<_, (Uuid,)>(
            r#"
            INSERT INTO user_dishes
                (user_id, catalog_dish_id, name, description, instructions,
                 prep_time_minutes, cook_time_minutes, servings,
                 allergens, allergens_overridden, occasion_tags, tags,
                 nutrition, nutrition_overridden)
            SELECT $1, dish_id, name, description, instructions,
                   prep_time_minutes, cook_time_minutes, servings,
                   allergens, allergens_overridden, occasion_tags, tags,
                   nutrition, nutrition_overridden
            FROM catalog_dishes WHERE dish_id = $2
            RETURNING user_dish_id
            "#,
        )
        .bind(user_id)
        .bind(catalog_dish_id)
        .fetch_one(&mut *tx)
        .await?;

        // Update pref to point to the new personal dish
        sqlx::query(
            "UPDATE user_dish_prefs SET user_dish_id = $1, updated_at = NOW() \
             WHERE user_dish_pref_id = $2",
        )
        .bind(new_ud_id)
        .bind(pref_id)
        .execute(&mut *tx)
        .await?;

        new_ud_id
    };

    // Apply recipe update to user_dishes
    sqlx::query(
        r#"
        UPDATE user_dishes SET
            name                = COALESCE($3, name),
            instructions        = COALESCE($4, instructions),
            prep_time_minutes   = COALESCE($5, prep_time_minutes),
            cook_time_minutes   = COALESCE($6, cook_time_minutes),
            updated_at          = NOW()
        WHERE user_dish_id = $1 AND user_id = $2
        "#,
    )
    .bind(user_dish_id)
    .bind(user_id)
    .bind(name)
    .bind(instructions)
    .bind(prep_time_minutes)
    .bind(cook_time_minutes)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    get(pool, user_id, pref_id).await
}

#[tracing::instrument(skip(pool), fields(table = "user_dish_prefs", op = "delete"))]
pub async fn delete(pool: &PgPool, user_id: Uuid, pref_id: Uuid) -> Result<bool, DatabaseError> {
    // Also delete the personal user_dish if it exists (cascade not set — manual delete)
    let mut tx = pool.begin().await?;

    let row = sqlx::query_as::<_, (Option<Uuid>,)>(
        "DELETE FROM user_dish_prefs WHERE user_id = $1 AND user_dish_pref_id = $2 RETURNING user_dish_id",
    )
    .bind(user_id)
    .bind(pref_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((user_dish_id,)) = row else {
        return Ok(false);
    };

    // If a personal dish exists, delete it too
    if let Some(ud_id) = user_dish_id {
        sqlx::query("DELETE FROM user_dishes WHERE user_dish_id = $1 AND user_id = $2")
            .bind(ud_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(true)
}

#[tracing::instrument(
    skip(pool, params),
    fields(table = "user_dish_prefs", op = "add_ingredient")
)]
pub async fn add_ingredient(
    pool: &PgPool,
    user_id: Uuid,
    pref_id: Uuid,
    params: AddIngredientParams,
) -> Result<Option<UserDishPrefDetail>, DatabaseError> {
    let mut tx = pool.begin().await?;

    // Ensure fork if catalog-backed
    let user_dish_id = ensure_forked(&mut tx, user_id, pref_id).await?;
    let Some(user_dish_id) = user_dish_id else {
        return Ok(None);
    };

    sqlx::query(
        r#"
        INSERT INTO user_dish_ingredients
            (user_dish_id, ingredient_id, quantity, unit, preparation_note, is_optional, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_dish_id, ingredient_id) DO UPDATE
            SET quantity         = EXCLUDED.quantity,
                unit             = EXCLUDED.unit,
                preparation_note = EXCLUDED.preparation_note,
                is_optional      = EXCLUDED.is_optional,
                sort_order       = EXCLUDED.sort_order
        "#,
    )
    .bind(user_dish_id)
    .bind(params.ingredient_id)
    .bind(params.quantity)
    .bind(params.unit)
    .bind(params.preparation_note)
    .bind(params.is_optional)
    .bind(params.sort_order)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    get(pool, user_id, pref_id).await
}

#[tracing::instrument(
    skip(pool),
    fields(table = "user_dish_prefs", op = "remove_ingredient")
)]
pub async fn remove_ingredient(
    pool: &PgPool,
    user_id: Uuid,
    pref_id: Uuid,
    ingredient_id: Uuid,
) -> Result<Option<bool>, DatabaseError> {
    let mut tx = pool.begin().await?;

    let user_dish_id = ensure_forked(&mut tx, user_id, pref_id).await?;
    let Some(user_dish_id) = user_dish_id else {
        return Ok(None); // pref not found
    };

    let result = sqlx::query(
        "DELETE FROM user_dish_ingredients WHERE user_dish_id = $1 AND ingredient_id = $2",
    )
    .bind(user_dish_id)
    .bind(ingredient_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Some(result.rows_affected() > 0))
}

/// Ensure a personal user_dish exists for this pref, forking from catalog if needed.
/// Returns Some(user_dish_id) if pref found, None if pref not found.
async fn ensure_forked(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    pref_id: Uuid,
) -> Result<Option<Uuid>, DatabaseError> {
    let row = sqlx::query_as::<_, (Option<Uuid>, Option<Uuid>)>(
        "SELECT user_dish_id, catalog_dish_id FROM user_dish_prefs \
         WHERE user_id = $1 AND user_dish_pref_id = $2 FOR UPDATE",
    )
    .bind(user_id)
    .bind(pref_id)
    .fetch_optional(&mut **tx)
    .await?;

    let Some((current_user_dish_id, catalog_dish_id)) = row else {
        return Ok(None);
    };

    if let Some(uid) = current_user_dish_id {
        return Ok(Some(uid));
    }

    // Fork from catalog
    let catalog_id = catalog_dish_id.expect("CHECK constraint ensures one is set");
    let (new_ud_id,) = sqlx::query_as::<_, (Uuid,)>(
        r#"
        INSERT INTO user_dishes
            (user_id, catalog_dish_id, name, description, instructions,
             prep_time_minutes, cook_time_minutes, servings,
             allergens, allergens_overridden, occasion_tags, tags,
             nutrition, nutrition_overridden)
        SELECT $1, dish_id, name, description, instructions,
               prep_time_minutes, cook_time_minutes, servings,
               allergens, allergens_overridden, occasion_tags, tags,
               nutrition, nutrition_overridden
        FROM catalog_dishes WHERE dish_id = $2
        RETURNING user_dish_id
        "#,
    )
    .bind(user_id)
    .bind(catalog_id)
    .fetch_one(&mut **tx)
    .await?;

    sqlx::query(
        "UPDATE user_dish_prefs SET user_dish_id = $1, updated_at = NOW() \
         WHERE user_dish_pref_id = $2",
    )
    .bind(new_ud_id)
    .bind(pref_id)
    .execute(&mut **tx)
    .await?;

    Ok(Some(new_ud_id))
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
        let pref = create_from_scratch(
            &pool,
            uid,
            "Test Dish",
            Some("instructions"),
            Some(10),
            Some(20),
        )
        .await
        .expect("create_from_scratch failed");

        assert_eq!(pref.user_id, uid);
        assert_eq!(pref.name, "Test Dish");
        assert_eq!(pref.source, "personal");
        assert!(pref.has_personal_recipe);
        assert!(pref.user_dish_id.is_some());
        assert!(pref.catalog_dish_id.is_none());
    }

    // -----------------------------------------------------------------------
    // list
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn list_returns_created_dish(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid_a, "Listed Dish", None, None, None)
            .await
            .unwrap();
        // Create a pref for a second user — must not appear in uid_a's list
        create_from_scratch(&pool, uid_b, "Other User Dish", None, None, None)
            .await
            .unwrap();

        let results = list(&pool, uid_a).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].user_dish_pref_id, pref.user_dish_pref_id);
    }

    // -----------------------------------------------------------------------
    // get
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn get_returns_dish(pool: PgPool) {
        let uid = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid, "Get Dish", None, None, None)
            .await
            .unwrap();

        let found = get(&pool, uid, pref.user_dish_pref_id).await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().user_dish_pref_id, pref.user_dish_pref_id);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn get_returns_none_for_wrong_user(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid_a, "Private Dish", None, None, None)
            .await
            .unwrap();

        let found = get(&pool, uid_b, pref.user_dish_pref_id).await.unwrap();
        assert!(found.is_none());
    }

    // -----------------------------------------------------------------------
    // update_metadata
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn update_metadata_sets_rating_and_flags(pool: PgPool) {
        let uid = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid, "Rated Dish", None, None, None)
            .await
            .unwrap();

        let updated = update_metadata(
            &pool,
            uid,
            pref.user_dish_pref_id,
            Some(Some(5)),
            Some(true),
            Some(false),
            Some(Some("comfort food".to_string())),
        )
        .await
        .unwrap();

        let updated = updated.expect("update returned None");
        assert_eq!(updated.rating, Some(5));
        assert!(updated.is_safe_food);
        assert!(!updated.is_blocked);
        assert_eq!(updated.notes.as_deref(), Some("comfort food"));
    }

    // -----------------------------------------------------------------------
    // fork_and_update_recipe
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn fork_and_update_recipe_returns_updated(pool: PgPool) {
        let uid = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid, "Original Dish", None, Some(5), None)
            .await
            .unwrap();

        let updated = fork_and_update_recipe(
            &pool,
            uid,
            pref.user_dish_pref_id,
            Some("Updated Dish"),
            Some("New instructions"),
            Some(15),
            Some(30),
        )
        .await
        .unwrap();

        let updated = updated.expect("fork_and_update_recipe returned None");
        assert_eq!(updated.name, "Updated Dish");
        assert!(updated.has_personal_recipe);
        // user_dish_id must not change (no new fork was needed)
        assert_eq!(updated.user_dish_id, pref.user_dish_id);

        // Verify instructions and timing were persisted in user_dishes
        let (instructions, prep_time, cook_time): (Option<String>, Option<i32>, Option<i32>) =
            sqlx::query_as(
                "SELECT instructions, prep_time_minutes, cook_time_minutes \
                 FROM user_dishes WHERE user_dish_id = $1",
            )
            .bind(updated.user_dish_id.unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(instructions.as_deref(), Some("New instructions"));
        assert_eq!(prep_time, Some(15));
        assert_eq!(cook_time, Some(30));
    }

    // -----------------------------------------------------------------------
    // add_ingredient / remove_ingredient
    // -----------------------------------------------------------------------

    #[sqlx::test(migrations = "./migrations")]
    async fn add_ingredient_links_ingredient(pool: PgPool) {
        use rust_decimal::Decimal;

        let uid = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid, "Dish With Ingredient", None, None, None)
            .await
            .unwrap();

        // Seed a catalog ingredient via direct SQL
        let (ingredient_id,): (Uuid,) = sqlx::query_as(
            "INSERT INTO catalog_ingredients (name, allergens, occasion_tags) \
             VALUES ('test ingredient', '{}', '{}') RETURNING ingredient_id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let params = AddIngredientParams {
            ingredient_id,
            quantity: Decimal::new(2, 0),
            unit: "cups".to_string(),
            preparation_note: None,
            is_optional: false,
            sort_order: 0,
        };

        let result = add_ingredient(&pool, uid, pref.user_dish_pref_id, params)
            .await
            .unwrap();
        assert!(result.is_some());

        let (linked_ingredient_id,): (Uuid,) = sqlx::query_as(
            "SELECT ingredient_id FROM user_dish_ingredients WHERE user_dish_id = $1",
        )
        .bind(pref.user_dish_id.unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(linked_ingredient_id, ingredient_id);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn remove_ingredient_unlinks(pool: PgPool) {
        use rust_decimal::Decimal;

        let uid = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid, "Dish Lose Ingredient", None, None, None)
            .await
            .unwrap();

        let (ingredient_id,): (Uuid,) = sqlx::query_as(
            "INSERT INTO catalog_ingredients (name, allergens, occasion_tags) \
             VALUES ('removable ingredient', '{}', '{}') RETURNING ingredient_id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let params = AddIngredientParams {
            ingredient_id,
            quantity: Decimal::new(1, 0),
            unit: "tbsp".to_string(),
            preparation_note: None,
            is_optional: false,
            sort_order: 0,
        };
        add_ingredient(&pool, uid, pref.user_dish_pref_id, params)
            .await
            .unwrap();

        let removed = remove_ingredient(&pool, uid, pref.user_dish_pref_id, ingredient_id)
            .await
            .unwrap();
        assert_eq!(removed, Some(true));

        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM user_dish_ingredients WHERE user_dish_id = $1")
                .bind(pref.user_dish_id.unwrap())
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
        let pref = create_from_scratch(&pool, uid, "Dish To Delete", None, None, None)
            .await
            .unwrap();

        let user_dish_id = pref.user_dish_id.unwrap();
        let deleted = delete(&pool, uid, pref.user_dish_pref_id).await.unwrap();
        assert!(deleted);

        let found = get(&pool, uid, pref.user_dish_pref_id).await.unwrap();
        assert!(found.is_none());

        // The personal user_dish must also be deleted (cascade)
        let dish_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM user_dishes WHERE user_dish_id = $1")
                .bind(user_dish_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(dish_count.0, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_wrong_user_returns_false(pool: PgPool) {
        let uid_a = new_user(&pool).await;
        let uid_b = new_user(&pool).await;
        let pref = create_from_scratch(&pool, uid_a, "Dish Not Yours", None, None, None)
            .await
            .unwrap();

        let deleted = delete(&pool, uid_b, pref.user_dish_pref_id).await.unwrap();
        assert!(!deleted);
    }
}
