use crate::api_response::MealSuggestionResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, Query, State},
    http::StatusCode,
};
use chrono::NaiveDate;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct SuggestionsQuery {
    pub date: NaiveDate,
    pub slot: String,
}

#[utoipa::path(
    get,
    path = "/my/meal-suggestions",
    tag = "Meal Suggestions",
    params(
        ("date" = NaiveDate, Query, description = "ISO date (YYYY-MM-DD)"),
        ("slot" = String, Query, description = "Meal slot (any non-empty string matching an occasion_tag, e.g. breakfast, lunch, dinner, snack, or a custom tag)"),
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Meal suggestions for the slot", body = Vec<MealSuggestionResponse>),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Empty slot value"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn get_suggestions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SuggestionsQuery>,
) -> Result<Json<Vec<MealSuggestionResponse>>, StatusCode> {
    validate_slot(&params.slot)?;

    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .meal_suggestion
        .get_suggestions(user_id, &params.slot, params.date)
        .await
        .map(|v| Json(v.into_iter().map(MealSuggestionResponse::from).collect()))
        .map_err(|e| {
            tracing::error!(error = %e, "get_suggestions DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

fn validate_slot(slot: &str) -> Result<(), StatusCode> {
    if slot.trim().is_empty() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_slots_accepted() {
        for slot in &["breakfast", "lunch", "dinner", "snack"] {
            assert!(
                validate_slot(slot).is_ok(),
                "canonical slot '{slot}' must be accepted"
            );
        }
    }

    #[test]
    fn non_canonical_slot_accepted() {
        assert!(validate_slot("second_breakfast").is_ok());
        assert!(validate_slot("post-workout").is_ok());
        assert!(validate_slot("brunch").is_ok());
    }

    #[test]
    fn empty_slot_rejected() {
        assert_eq!(
            validate_slot("").unwrap_err(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn whitespace_only_slot_rejected() {
        assert_eq!(
            validate_slot("   ").unwrap_err(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}
