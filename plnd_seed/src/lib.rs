pub mod dev_user;
pub mod dishes;
pub mod error;
pub mod ingredients;
pub mod meals;

pub use error::SeedError;

use plnd_data::providers::{NutritionProvider, RecipeProvider};
use std::sync::Arc;
use std::time::Duration;

/// Autonomous entry point for seeding — creates its own pool from a URL.
pub async fn run_seed(
    database_url: &str,
    max_connections: u32,
    nutrition_providers: &[Arc<dyn NutritionProvider>],
    recipe_providers: &[Arc<dyn RecipeProvider>],
) -> Result<(), SeedError> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(600))
        .connect(database_url)
        .await
        .map_err(SeedError::Database)?;
    seed(&pool, nutrition_providers, recipe_providers).await
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
    nutrition_providers: &[Arc<dyn NutritionProvider>],
    recipe_providers: &[Arc<dyn RecipeProvider>],
) -> Result<(), SeedError> {
    // Fast idempotency check — skip all HTTP if catalog already has seeded data
    let already_seeded: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM catalog_ingredients WHERE external_source IS NOT NULL LIMIT 1)",
    )
    .fetch_one(pool)
    .await?;

    if already_seeded {
        println!("Catalog seed: already seeded, skipping.");
        return Ok(());
    }

    println!(
        "Catalog seed: fetching ingredients from {} provider(s)...",
        nutrition_providers.len()
    );
    let fetched_ingredients = ingredients::fetch_ingredients(nutrition_providers).await;
    println!(
        "Catalog seed: fetched {} ingredient(s).",
        fetched_ingredients.len()
    );

    println!(
        "Catalog seed: fetching dishes from {} provider(s)...",
        recipe_providers.len()
    );
    let fetched_dishes = dishes::fetch_dishes(recipe_providers).await;
    println!("Catalog seed: fetched {} dish(es).", fetched_dishes.len());

    // Single transaction: all DB writes or none
    let mut tx = pool.begin().await?;

    let ingredients_inserted =
        ingredients::insert_ingredients(&mut tx, &fetched_ingredients).await?;
    println!(
        "Catalog seed: inserted {} ingredient(s).",
        ingredients_inserted
    );

    let dishes_upserted = dishes::insert_dishes(&mut tx, &fetched_dishes).await?;
    println!("Catalog seed: upserted {} dish(es).", dishes_upserted);

    let meals_inserted = meals::insert_meals(&mut tx).await?;
    println!("Catalog seed: inserted {} meal(s).", meals_inserted);

    tx.commit().await?;
    println!("Catalog seed: complete.");

    Ok(())
}
