use async_trait::async_trait;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::UserIngredientPref;

#[async_trait]
pub trait UserIngredientPrefRepository: Send + Sync {
    async fn list(&self, user_id: Uuid) -> Result<Vec<UserIngredientPref>, DatabaseError>;

    async fn upsert(
        &self,
        user_id: Uuid,
        catalog_ingredient_id: Uuid,
        is_blocked: bool,
        notes: Option<&str>,
    ) -> Result<UserIngredientPref, DatabaseError>;

    async fn delete(
        &self,
        user_id: Uuid,
        catalog_ingredient_id: Uuid,
    ) -> Result<bool, DatabaseError>;
}
