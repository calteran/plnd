use crate::clients::dtos::ExternalDish;
use crate::clients::{dtos::SearchQuery, dtos::SearchResult, error::ExternalClientError};
use async_trait::async_trait;

/// Abstraction over any recipe / dish data provider (e.g. Spoonacular, Edamam).
///
/// The `source_name()` return value is written into `catalog_dishes.external_source`
/// (e.g. `"spoonacular"`, `"edamam"`).
#[async_trait]
pub trait RecipeProvider: Send + Sync {
    /// Short identifier for this provider, written into `catalog_dishes.external_source`.
    fn source_name(&self) -> &str;

    /// Search for dishes matching the query.
    async fn search_dishes(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalClientError>;

    /// Fetch a single dish by the provider's own ID.
    ///
    /// Returns `Ok(None)` when the provider confirms the ID no longer exists.
    async fn get_dish_by_id(
        &self,
        external_id: &str,
    ) -> Result<Option<ExternalDish>, ExternalClientError>;
}
