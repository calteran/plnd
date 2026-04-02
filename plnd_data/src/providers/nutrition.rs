use crate::providers::dtos::ExternalIngredient;
use crate::providers::{dtos::SearchQuery, dtos::SearchResult, error::ExternalProviderError};
use async_trait::async_trait;

/// Abstraction over any nutrition / ingredient data provider (e.g. USDA FDC, OpenFoodFacts).
///
/// The `source_name()` return value is written into `catalog_ingredients.external_source`
/// so records can be traced back to their origin (e.g. `"usda_fdc"`, `"openfoodfacts"`).
#[async_trait]
pub trait NutritionProvider: Send + Sync {
    /// Short identifier for this provider, written into `catalog_ingredients.external_source`.
    fn source_name(&self) -> &str;

    /// Search for ingredients matching the query.
    async fn search_ingredients(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalProviderError>;

    /// Fetch a single ingredient by the provider's own ID.
    ///
    /// Returns `Ok(None)` when the provider confirms the ID no longer exists,
    /// as distinct from an `Err(ExternalProviderError::NotFound)` for unexpected absences.
    async fn get_ingredient_by_id(
        &self,
        external_id: &str,
    ) -> Result<Option<ExternalIngredient>, ExternalProviderError>;
}
