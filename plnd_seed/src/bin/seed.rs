use plnd_data::clients::{
    NutritionProvider, OpenFoodFactsClient, RecipeProvider, TheMealDbClient, UsdaFdcClient,
};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let database_url = std::env::var("DATABASE_URL")
        .or_else(|_| std::env::var("APP_DATABASE__URL"))
        .map_err(|_| anyhow::anyhow!("DATABASE_URL or APP_DATABASE__URL must be set"))?;

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    let usda_key = std::env::var("USDA_FDC_API_KEY")
        .or_else(|_| std::env::var("APP_EXTERNAL__USDA_FDC_API_KEY"))
        .unwrap_or_default();
    let mdb_key = std::env::var("THEMEALDB_API_KEY")
        .or_else(|_| std::env::var("APP_EXTERNAL__THEMEALDB_API_KEY"))
        .unwrap_or_else(|_| "1".to_string());

    let off_base_url = std::env::var("OFF_BASE_URL")
        .unwrap_or_else(|_| "https://world.openfoodfacts.net".to_string());
    let off_basic_auth_user =
        std::env::var("OFF_BASIC_AUTH_USER").unwrap_or_else(|_| "off".to_string());
    let off_basic_auth = if off_basic_auth_user.is_empty() {
        None
    } else {
        let pass = std::env::var("OFF_BASIC_AUTH_PASSWORD").unwrap_or_else(|_| "off".to_string());
        Some((off_basic_auth_user, pass))
    };

    let nutrition_providers: Vec<Arc<dyn NutritionProvider>> = vec![
        Arc::new(UsdaFdcClient::new(&usda_key)),
        Arc::new(OpenFoodFactsClient::new(&off_base_url, off_basic_auth)),
    ];
    let recipe_providers: Vec<Arc<dyn RecipeProvider>> =
        vec![Arc::new(TheMealDbClient::new(&mdb_key))];

    println!("Running catalog seed from external providers...");
    plnd_seed::seed(&pool, &nutrition_providers, &recipe_providers).await?;
    println!("Done.");
    Ok(())
}
