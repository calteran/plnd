use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;

/// A meal or dish returned as a planning suggestion.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MealSuggestion {
    pub id:              Uuid,
    pub name:            String,
    /// "meal" or "dish"
    pub suggestion_type: String,
}

/// Return up to 10 meal/dish suggestions for the given user and slot.
///
/// Results are drawn from `user_meals` and `user_dishes` where:
/// - `occasion_tags` contains `slot` (e.g. "breakfast", "lunch", "dinner", "snack")
/// - `is_blocked = false`
///
/// Ordered by name, limited to 10.
///
/// The `date` parameter is accepted for forward-compatibility (future
/// implementations may filter by recency or season) but is not used in
/// the query today.
#[tracing::instrument(skip(pool), fields(table = "user_meals/user_dishes", op = "suggestions"))]
pub async fn get_suggestions(
    pool: &PgPool,
    user_id: Uuid,
    slot: &str,
    _date: &str,
) -> Result<Vec<MealSuggestion>, DatabaseError> {
    sqlx::query_as::<_, MealSuggestion>(
        r#"
        SELECT user_meal_id AS id,
               name,
               'meal'::TEXT AS suggestion_type
        FROM user_meals
        WHERE user_id = $1
          AND $2 = ANY(occasion_tags)
          AND is_blocked = false

        UNION ALL

        SELECT user_dish_id AS id,
               name,
               'dish'::TEXT AS suggestion_type
        FROM user_dishes
        WHERE user_id = $1
          AND $2 = ANY(occasion_tags)
          AND is_blocked = false

        ORDER BY name
        LIMIT 10
        "#,
    )
    .bind(user_id)
    .bind(slot)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}
