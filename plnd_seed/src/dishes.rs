use plnd_data::providers::dtos::{ExternalDish, SearchQuery};
use plnd_data::providers::RecipeProvider;
use sqlx::PgConnection;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

use crate::error::SeedError;

pub const DISH_TERMS: &[&str] = &["chicken", "pasta", "scrambled eggs", "salad", "porridge"];

/// Informational tag written on every auto-seeded dish so seeded rows can be
/// queried by tag. Deduplication is handled by the `uq_dish_external` constraint,
/// not by this tag.
pub const AUTO_SEEDED_TAG: &str = "auto-seeded";

/// Fetch dishes from all providers for all search terms, deduplicated by
/// (source_name, external_id). Returns a flat list of (source, dish) pairs
/// ready for DB insertion.
pub async fn fetch_dishes(providers: &[Arc<dyn RecipeProvider>]) -> Vec<(String, ExternalDish)> {
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut results: Vec<(String, ExternalDish)> = Vec::new();

    for provider in providers {
        let source = provider.source_name().to_string();

        for &term in DISH_TERMS {
            let search_query = SearchQuery {
                query: term.to_string(),
                limit: 2,
                exclude_allergens: vec![],
            };

            let search_results = match provider.search_dishes(&search_query).await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!(
                        "Seed warning: dish search '{}' from {} failed: {}",
                        term, source, e
                    );
                    continue;
                }
            };

            for result in search_results {
                let key = (source.clone(), result.external_id.clone());
                if seen.contains(&key) {
                    continue;
                }

                match provider.get_dish_by_id(&result.external_id).await {
                    Ok(Some(dish)) => {
                        seen.insert(key);
                        results.push((source.clone(), dish));
                    }
                    Ok(None) => {
                        // Provider confirmed it no longer exists — skip silently
                    }
                    Err(e) => {
                        eprintln!(
                            "Seed warning: get_dish_by_id '{}' from {} failed: {}",
                            result.external_id, source, e
                        );
                    }
                }
            }
        }
    }

    results
}

/// Upsert a batch of (source, dish) pairs into `catalog_dishes` + `catalog_dish_ingredients`.
///
/// On conflict (`uq_dish_external`), the existing row is updated with the latest
/// data from the provider. The `_overridden` flags are respected: allergens and
/// nutrition are only overwritten if the user has NOT manually verified them.
///
/// Returns the number of rows upserted (inserted + updated).
pub async fn insert_dishes(
    tx: &mut PgConnection,
    dishes: &[(String, ExternalDish)],
) -> Result<usize, SeedError> {
    let mut upserted = 0usize;

    for (source, dish) in dishes {
        let dish_id = Uuid::new_v4();
        let nutrition_json: Option<serde_json::Value> = match &dish.nutrition {
            Some(n) => Some(serde_json::to_value(n)?),
            None => None,
        };
        let tags = vec![AUTO_SEEDED_TAG.to_string()];

        // RETURNING dish_id is required: on the DO UPDATE path the row already
        // exists with its original dish_id — we must use that for ingredient linking,
        // not the newly-generated UUID above.
        let (actual_dish_id,): (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO catalog_dishes
                (dish_id, name, instructions, prep_time_minutes, cook_time_minutes,
                 servings, allergens, allergens_overridden, occasion_tags,
                 nutrition, nutrition_overridden, tags, external_id, external_source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, false, $10, $11, $12)
            ON CONFLICT ON CONSTRAINT uq_dish_external DO UPDATE SET
                name              = EXCLUDED.name,
                instructions      = EXCLUDED.instructions,
                prep_time_minutes = EXCLUDED.prep_time_minutes,
                cook_time_minutes = EXCLUDED.cook_time_minutes,
                servings          = EXCLUDED.servings,
                allergens         = CASE WHEN catalog_dishes.allergens_overridden
                                         THEN catalog_dishes.allergens
                                         ELSE EXCLUDED.allergens END,
                occasion_tags     = EXCLUDED.occasion_tags,
                nutrition         = CASE WHEN catalog_dishes.nutrition_overridden
                                         THEN catalog_dishes.nutrition
                                         ELSE EXCLUDED.nutrition END,
                tags              = EXCLUDED.tags,
                updated_at        = now()
            RETURNING dish_id
            "#,
        )
        .bind(dish_id)
        .bind(&dish.name)
        .bind(&dish.instructions)
        .bind(dish.prep_time_minutes)
        .bind(dish.cook_time_minutes)
        .bind(dish.servings)
        .bind(&dish.allergens)
        .bind(&dish.occasion_tags)
        .bind(nutrition_json)
        .bind(&tags)
        .bind(&dish.external_id)
        .bind(source)
        .fetch_one(&mut *tx)
        .await?;

        // Link ingredients by name lookup. Run on both insert and update paths so
        // newly-added ingredients in a recipe revision get picked up. Existing
        // links are updated in place (quantity/unit may change between provider versions).
        for (sort_idx, dish_ingredient) in dish.ingredients.iter().enumerate() {
            let ingredient_id: Option<Uuid> = sqlx::query_scalar(
                "SELECT ingredient_id FROM catalog_ingredients WHERE LOWER(name) = LOWER($1) LIMIT 1",
            )
            .bind(&dish_ingredient.name)
            .fetch_optional(&mut *tx)
            .await?;

            if let Some(ingredient_id) = ingredient_id {
                let dish_ingredient_id = Uuid::new_v4();
                let sort_order = sort_idx as i16;

                sqlx::query(
                    r#"
                    INSERT INTO catalog_dish_ingredients
                        (dish_ingredient_id, dish_id, ingredient_id, quantity, unit,
                         preparation_note, is_optional, sort_order)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT ON CONSTRAINT uq_dish_ingredient DO UPDATE SET
                        quantity         = EXCLUDED.quantity,
                        unit             = EXCLUDED.unit,
                        preparation_note = EXCLUDED.preparation_note,
                        is_optional      = EXCLUDED.is_optional,
                        sort_order       = EXCLUDED.sort_order
                    "#,
                )
                .bind(dish_ingredient_id)
                .bind(actual_dish_id)
                .bind(ingredient_id)
                .bind(dish_ingredient.quantity)
                .bind(&dish_ingredient.unit)
                .bind(&dish_ingredient.preparation_note)
                .bind(dish_ingredient.is_optional)
                .bind(sort_order)
                .execute(&mut *tx)
                .await?;
            }
            // If ingredient not found by name — skip silently, dish still seeded
        }

        upserted += 1;
    }

    Ok(upserted)
}
