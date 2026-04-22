use async_trait::async_trait;
use uuid::Uuid;

use crate::models::UserIngredientPref;

#[async_trait]
pub trait UserIngredientPrefRepository: Send + Sync {
    async fn list(&self, user_id: Uuid) -> Result<Vec<UserIngredientPref>, crate::Error>;

    async fn upsert(
        &self,
        user_id: Uuid,
        catalog_ingredient_id: Uuid,
        preference_score: i16,
        notes: Option<&str>,
    ) -> Result<UserIngredientPref, crate::Error>;

    async fn delete(
        &self,
        user_id: Uuid,
        catalog_ingredient_id: Uuid,
    ) -> Result<bool, crate::Error>;
}
