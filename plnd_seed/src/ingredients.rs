use plnd_data::providers::NutritionProvider;
use plnd_data::providers::dtos::{ExternalIngredient, SearchQuery};
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
    "cheese",
    "chicken",
    "beef",
    "pork",
    "salmon",
    "tuna",
    "shrimp",
    "tofu",
    "rice",
    "pasta",
    "bread",
    "butter",
    "yogurt",
    "spinach",
    "tomato",
    "onion",
    "garlic",
    "potato",
    "sweet potato",
    "carrot",
    "apple",
    "orange",
    "strawberry",
    "blueberry",
    "almond",
    "peanut butter",
    "black beans",
    "lentils",
    "avocado",
    "corn",
    "lettuce",
    "mushroom",
];

/// Fetch ingredients from all providers for all search terms, deduplicated by
/// (source_name, external_id). Returns a flat list ready for DB insertion.
pub async fn fetch_ingredients(
    providers: &[Arc<dyn NutritionProvider>],
) -> Vec<(String, ExternalIngredient)> {
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut results: Vec<(String, ExternalIngredient)> = Vec::new();

    for provider in providers {
        if !provider.is_canonical_source() {
            tracing::info!(
                provider = provider.source_name(),
                "catalog seed: skipping non-canonical source (branded names not seeded)"
            );
            continue;
        }
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
                    tracing::warn!(term, provider = %source, error = %e, "catalog seed: ingredient search failed");
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
                        tracing::warn!(external_id = %result.external_id, provider = %source, error = %e, "catalog seed: get_ingredient_by_id failed");
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

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use plnd_data::providers::NutritionProvider;
    use plnd_data::providers::dtos::{ExternalIngredient, SearchQuery, SearchResult};
    use plnd_data::providers::error::ExternalProviderError;
    use std::sync::Arc;

    struct StubProvider {
        source: String,
        canonical: bool,
    }

    #[async_trait]
    impl NutritionProvider for StubProvider {
        fn source_name(&self) -> &str {
            &self.source
        }
        fn is_canonical_source(&self) -> bool {
            self.canonical
        }
        async fn search_ingredients(
            &self,
            _query: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            Ok(vec![SearchResult {
                external_id: format!("{}-1", self.source),
                name: "Stub Food".to_string(),
                description: None,
                thumbnail_url: None,
            }])
        }
        async fn get_ingredient_by_id(
            &self,
            external_id: &str,
        ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
            Ok(Some(ExternalIngredient {
                external_id: external_id.to_string(),
                name: "Stub Food".to_string(),
                serving_size_g: None,
                nutrition: None,
                allergens: vec![],
                occasion_tags: vec![],
            }))
        }
    }

    #[tokio::test]
    async fn fetch_ingredients_skips_non_canonical_providers() {
        let providers: Vec<Arc<dyn NutritionProvider>> = vec![
            Arc::new(StubProvider {
                source: "canon".to_string(),
                canonical: true,
            }),
            Arc::new(StubProvider {
                source: "branded".to_string(),
                canonical: false,
            }),
        ];

        let fetched = fetch_ingredients(&providers).await;

        assert!(
            !fetched.is_empty(),
            "the canonical provider must contribute rows"
        );
        assert!(
            fetched.iter().all(|(source, _)| source == "canon"),
            "no branded-source rows may be seeded"
        );
    }

    #[test]
    fn seed_terms_include_common_ingredients_and_are_deduped() {
        assert!(
            INGREDIENT_TERMS.contains(&"cheese"),
            "cheese must be seeded (the #858 example)"
        );
        assert!(
            INGREDIENT_TERMS.len() >= 30,
            "seed list should be meaningfully widened"
        );
        let mut sorted = INGREDIENT_TERMS.to_vec();
        sorted.sort_unstable();
        let before = sorted.len();
        sorted.dedup();
        assert_eq!(before, sorted.len(), "seed terms must be unique");
    }
}
