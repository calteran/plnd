use async_trait::async_trait;

use crate::models::LocalExerciseResult;

#[async_trait]
pub trait ExerciseRepository: Send + Sync {
    async fn search_exercises(
        &self,
        q: &str,
        limit: i64,
    ) -> Result<Vec<LocalExerciseResult>, crate::Error>;
}
