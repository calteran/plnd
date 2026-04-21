use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Meal suggestion query result
// ---------------------------------------------------------------------------

/// A meal or dish returned as a planning suggestion.
#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct MealSuggestion {
    pub id: Uuid,
    pub name: String,
    /// "meal" or "dish"
    pub suggestion_type: String,
}
