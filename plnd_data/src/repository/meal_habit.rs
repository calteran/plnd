use async_trait::async_trait;
use uuid::Uuid;

use crate::models::MealHabit;

#[async_trait]
pub trait MealHabitRepository: Send + Sync {
    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<MealHabit>, crate::Error>;

    async fn create(
        &self,
        user_id: Uuid,
        meal_name: &str,
        slot: &str,
        recurrence_rule: &str,
    ) -> Result<MealHabit, crate::Error>;

    async fn delete(&self, id: Uuid, user_id: Uuid) -> Result<bool, crate::Error>;
}
