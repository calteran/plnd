use plnd_data::clients::dtos::{ExternalDish, SearchQuery};
use plnd_data::clients::RecipeProvider;
use sqlx::PgConnection;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

use crate::error::SeedError;

pub const DISH_TERMS: &[&str] = &["chicken", "pasta", "scrambled eggs", "salad", "porridge"];

/// Tag written on every auto-seeded dish so they can be identified without
/// a dedicated `external_source` column on `catalog_dishes`.
pub const AUTO_SEEDED_TAG: &str = "auto-seeded";

/// Fetch dishes from all providers for all search terms, deduplicated by
/// (source_name, external_id). Returns a flat list ready for DB insertion.
pub async fn fetch_dishes(providers: &[Arc<dyn RecipeProvider>]) -> Vec<ExternalDish> {
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut results: Vec<ExternalDish> = Vec::new();

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
                        results.push(dish);
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

/// Insert a batch of dishes into `catalog_dishes` + `catalog_dish_ingredients`.
/// Idempotency: skip any dish whose name already exists in auto-seeded dishes.
pub async fn insert_dishes(
    tx: &mut PgConnection,
    dishes: &[ExternalDish],
) -> Result<usize, SeedError> {
    let mut inserted = 0usize;

    for dish in dishes {
        // Idempotency: skip if a same-named auto-seeded dish already exists
        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT dish_id FROM catalog_dishes WHERE name = $1 AND $2 = ANY(tags) LIMIT 1",
        )
        .bind(&dish.name)
        .bind(AUTO_SEEDED_TAG)
        .fetch_optional(&mut *tx)
        .await?;

        if existing.is_some() {
            continue;
        }

        let dish_id = Uuid::new_v4();
        let nutrition_json: Option<serde_json::Value> = match &dish.nutrition {
            Some(n) => Some(serde_json::to_value(n)?),
            None => None,
        };
        let tags = vec![AUTO_SEEDED_TAG.to_string()];

        sqlx::query(
            r#"
            INSERT INTO catalog_dishes
                (dish_id, name, instructions, prep_time_minutes, cook_time_minutes,
                 servings, allergens, allergens_overridden, occasion_tags,
                 nutrition, nutrition_overridden, tags)
            VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, false, $10)
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
        .execute(&mut *tx)
        .await?;

        // Link ingredients by name lookup against the just-inserted catalog_ingredients
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
                    ON CONFLICT ON CONSTRAINT uq_dish_ingredient DO NOTHING
                    "#,
                )
                .bind(dish_ingredient_id)
                .bind(dish_id)
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

        inserted += 1;
    }

    Ok(inserted)
}
