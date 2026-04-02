use crate::providers::dtos::ExternalExercise;
use crate::providers::{dtos::SearchQuery, dtos::SearchResult, error::ExternalProviderError};
use async_trait::async_trait;

/// Abstraction over any exercise data provider (e.g. WGER, MuscleWiki).
///
/// The `source_name()` return value is written into `catalog_exercises.external_source`
/// (e.g. `"wger"`, `"musclewiki"`).
///
/// Concrete implementors are responsible for normalizing `intensity` to one of the values
/// in `VALID_INTENSITY_LEVELS` (`"low"`, `"moderate"`, `"high"`).
#[async_trait]
pub trait ExerciseProvider: Send + Sync {
    /// Short identifier for this provider, written into `catalog_exercises.external_source`.
    fn source_name(&self) -> &str;

    /// Search for exercises matching the query.
    async fn search_exercises(
        &self,
        query: &SearchQuery,
    ) -> Result<Vec<SearchResult>, ExternalProviderError>;

    /// Fetch a single exercise by the provider's own ID.
    ///
    /// Returns `Ok(None)` when the provider confirms the ID no longer exists.
    async fn get_exercise_by_id(
        &self,
        external_id: &str,
    ) -> Result<Option<ExternalExercise>, ExternalProviderError>;
}
