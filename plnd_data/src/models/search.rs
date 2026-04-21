use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Search result types (returned by MealSearchRepository + ExerciseRepository)
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow, Serialize, Deserialize, Clone, Debug)]
pub struct LocalIngredientResult {
    pub ingredient_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub external_source: Option<String>,
}

#[derive(sqlx::FromRow, Serialize, Deserialize, Clone, Debug)]
pub struct LocalDishResult {
    pub dish_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub prep_time_minutes: Option<i32>,
    pub cook_time_minutes: Option<i32>,
    pub is_user_dish: bool,
}

#[derive(sqlx::FromRow, Serialize, Deserialize, Clone, Debug)]
pub struct LocalExerciseResult {
    pub exercise_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub intensity: String,
    pub muscle_groups: Vec<String>,
    pub external_source: Option<String>,
    pub is_user_exercise: bool,
}
