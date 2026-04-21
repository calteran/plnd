use async_trait::async_trait;
use sqlx::PgPool;

use crate::db::error::DatabaseError;
use crate::db::models::LocalExerciseResult;
use crate::db::search::search_exercises;
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
    ) -> Result<Vec<LocalExerciseResult>, DatabaseError> {
        search_exercises(&self.pool, q, limit).await
    }
}
