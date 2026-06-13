use plnd_data::providers::{RecipeProvider, TheMealDbProvider};
use std::sync::Arc;
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let database_url = std::env::var("DATABASE_URL")
        .or_else(|_| std::env::var("APP_DATABASE__URL"))
        .map_err(|_| anyhow::anyhow!("DATABASE_URL or APP_DATABASE__URL must be set"))?;

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(600))
        .connect(&database_url)
        .await?;

    let mdb_key = std::env::var("THEMEALDB_API_KEY")
        .or_else(|_| std::env::var("APP_EXTERNAL__THEMEALDB_API_KEY"))
        .unwrap_or_else(|_| "1".to_string());

    let recipe_providers: Vec<Arc<dyn RecipeProvider>> =
        vec![Arc::new(TheMealDbProvider::new(&mdb_key))];

    let corpus_path = plnd_seed::ingredients::resolve_corpus_path();

    println!("Running catalog seed from vendored USDA corpus...");
    plnd_seed::seed(&pool, &recipe_providers, &corpus_path).await?;

    println!("Running dev user seed...");
    plnd_seed::dev_user::seed_dev_user(&pool).await?;
    println!("Dev user seed complete.");

    println!("Done.");
    Ok(())
}
