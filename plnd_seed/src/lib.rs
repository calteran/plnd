pub mod dev_user;
pub mod dishes;
pub mod error;
pub mod ingredients;
pub mod meals;

pub use error::SeedError;

use plnd_data::providers::RecipeProvider;
use std::sync::Arc;
use std::time::Duration;

/// Autonomous entry point for seeding — creates its own pool from a URL.
pub async fn run_seed(
    database_url: &str,
    max_connections: u32,
    recipe_providers: &[Arc<dyn RecipeProvider>],
    corpus_path: &std::path::Path,
) -> Result<(), SeedError> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(600))
        .connect(database_url)
        .await
        .map_err(SeedError::Database)?;
    seed(&pool, recipe_providers, corpus_path).await
}

/// Seed the catalog tables with real data from external providers.
///
/// **Idempotent**: if any externally-sourced ingredient already exists,
/// the function returns `Ok(())` immediately without making HTTP calls.
///
/// For partial re-runs (e.g. dishes added but ingredients missing), individual
/// inserts are guarded by ON CONFLICT DO NOTHING on named unique constraints.
pub async fn seed(
    pool: &sqlx::PgPool,
    recipe_providers: &[Arc<dyn RecipeProvider>],
    corpus_path: &std::path::Path,
) -> Result<(), SeedError> {
    // Fast idempotency check — skip all corpus reads if catalog already has seeded data
    let already_seeded: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM catalog_ingredients WHERE external_source IS NOT NULL LIMIT 1)",
    )
    .fetch_one(pool)
    .await?;

    if already_seeded {
        tracing::info!("catalog seed: already seeded, skipping");
        return Ok(());
    }

    tracing::info!("catalog seed: loading ingredients from corpus");
    let fetched_ingredients = ingredients::load_corpus_ingredients(corpus_path)?;
    tracing::info!(
        count = fetched_ingredients.len(),
        "catalog seed: ingredients loaded"
    );

    tracing::info!(
        provider_count = recipe_providers.len(),
        "catalog seed: fetching dishes"
    );
    let fetched_dishes = dishes::fetch_dishes(recipe_providers).await;
    tracing::info!(count = fetched_dishes.len(), "catalog seed: dishes fetched");

    // Single transaction: all DB writes or none
    let mut tx = pool.begin().await?;

    let ingredients_inserted =
        ingredients::insert_ingredients(&mut tx, &fetched_ingredients).await?;
    tracing::info!(
        count = ingredients_inserted,
        "catalog seed: ingredients inserted"
    );

    let dishes_upserted = dishes::insert_dishes(&mut tx, &fetched_dishes).await?;
    tracing::info!(count = dishes_upserted, "catalog seed: dishes upserted");

    let meals_inserted = meals::insert_meals(&mut tx).await?;
    tracing::info!(count = meals_inserted, "catalog seed: meals inserted");

    tx.commit().await?;
    tracing::info!("catalog seed: complete");

    Ok(())
}
