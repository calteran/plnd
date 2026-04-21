use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::user_ingredient_prefs;
use crate::models::UserIngredientPref;
use crate::repository::user_ingredient_pref::UserIngredientPrefRepository;

pub struct PgUserIngredientPrefRepository {
    pool: PgPool,
}

impl PgUserIngredientPrefRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UserIngredientPrefRepository for PgUserIngredientPrefRepository {
    async fn list(&self, user_id: Uuid) -> Result<Vec<UserIngredientPref>, DatabaseError> {
        user_ingredient_prefs::list(&self.pool, user_id).await
    }

    async fn upsert(
        &self,
        user_id: Uuid,
        catalog_ingredient_id: Uuid,
        is_blocked: bool,
        notes: Option<&str>,
    ) -> Result<UserIngredientPref, DatabaseError> {
        user_ingredient_prefs::upsert(
            &self.pool,
            user_id,
            catalog_ingredient_id,
            is_blocked,
            notes,
        )
        .await
    }

    async fn delete(
        &self,
        user_id: Uuid,
        catalog_ingredient_id: Uuid,
    ) -> Result<bool, DatabaseError> {
        user_ingredient_prefs::delete(&self.pool, user_id, catalog_ingredient_id).await
    }
}
