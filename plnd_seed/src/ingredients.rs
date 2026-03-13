use plnd_data::clients::dtos::{ExternalIngredient, SearchQuery};
use plnd_data::clients::NutritionProvider;
use sqlx::PgConnection;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

use crate::error::SeedError;

pub const INGREDIENT_TERMS: &[&str] = &[
    "oats",
    "banana",
    "chicken breast",
    "brown rice",
    "broccoli",
    "milk",
    "egg",
    "olive oil",
];

/// Fetch ingredients from all providers for all search terms, deduplicated by
/// (source_name, external_id). Returns a flat list ready for DB insertion.
pub async fn fetch_ingredients(
    providers: &[Arc<dyn NutritionProvider>],
) -> Vec<(String, ExternalIngredient)> {
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut results: Vec<(String, ExternalIngredient)> = Vec::new();

    for provider in providers {
        let source = provider.source_name().to_string();
        let query_limit = 3;

        for &term in INGREDIENT_TERMS {
            let search_query = SearchQuery {
                query: term.to_string(),
                limit: query_limit,
                exclude_allergens: vec![],
            };

            let search_results = match provider.search_ingredients(&search_query).await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!(
                        "Seed warning: ingredient search '{}' from {} failed: {}",
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

                match provider.get_ingredient_by_id(&result.external_id).await {
                    Ok(Some(ingredient)) => {
                        seen.insert(key);
                        results.push((source.clone(), ingredient));
                    }
                    Ok(None) => {
                        // Provider confirmed it no longer exists — skip silently
                    }
                    Err(e) => {
                        eprintln!(
                            "Seed warning: get_ingredient_by_id '{}' from {} failed: {}",
                            result.external_id, source, e
                        );
                    }
                }
            }
        }
    }

    results
}

/// Insert a batch of (source, ingredient) pairs into `catalog_ingredients`.
/// Uses ON CONFLICT DO NOTHING for idempotency via the `uq_ingredient_external` constraint.
pub async fn insert_ingredients(
    tx: &mut PgConnection,
    ingredients: &[(String, ExternalIngredient)],
) -> Result<usize, SeedError> {
    let mut inserted = 0usize;

    for (source, ingredient) in ingredients {
        let ingredient_id = Uuid::new_v4();
        let nutrition_json: Option<serde_json::Value> = match &ingredient.nutrition {
            Some(n) => Some(serde_json::to_value(n)?),
            None => None,
        };

        let rows = sqlx::query(
            r#"
            INSERT INTO catalog_ingredients
                (ingredient_id, name, serving_size_g, nutrition,
                 allergens, occasion_tags, external_id, external_source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT ON CONSTRAINT uq_ingredient_external DO NOTHING
            "#,
        )
        .bind(ingredient_id)
        .bind(&ingredient.name)
        .bind(ingredient.serving_size_g)
        .bind(nutrition_json)
        .bind(&ingredient.allergens)
        .bind(&ingredient.occasion_tags)
        .bind(&ingredient.external_id)
        .bind(source)
        .execute(&mut *tx)
        .await?;

        if rows.rows_affected() > 0 {
            inserted += 1;
        }
    }

    Ok(inserted)
}
