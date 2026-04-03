use crate::api_response::MealSuggestionResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDate;
use plnd_data::db;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

const VALID_SLOTS: &[&str] = &["breakfast", "lunch", "dinner", "snack"];

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
        ("slot" = String, Query, description = "Meal slot: breakfast | lunch | dinner | snack"),
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Meal suggestions for the slot", body = Vec<MealSuggestionResponse>),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Invalid slot value"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn get_suggestions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SuggestionsQuery>,
) -> Result<Json<Vec<MealSuggestionResponse>>, StatusCode> {
    if !VALID_SLOTS.contains(&params.slot.as_str()) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::meal_suggestions::get_suggestions(pool, user_id, &params.slot, &params.date.to_string())
        .await
        .map(|v| Json(v.into_iter().map(MealSuggestionResponse::from).collect()))
        .map_err(|e| {
            tracing::error!(error = %e, "get_suggestions DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
