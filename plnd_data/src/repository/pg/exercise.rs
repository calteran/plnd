use async_trait::async_trait;
use sqlx::PgPool;

use crate::db::search::search_exercises;
use crate::models::LocalExerciseResult;
use crate::repository::exercise::ExerciseRepository;

pub struct PgExerciseRepository {
    pool: PgPool,
}

impl PgExerciseRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ExerciseRepository for PgExerciseRepository {
    async fn search_exercises(
        &self,
        q: &str,
        limit: i64,
    ) -> Result<Vec<LocalExerciseResult>, crate::Error> {
        search_exercises(&self.pool, q, limit)
            .await
            .map_err(Into::into)
    }
}
