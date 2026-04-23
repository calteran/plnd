use crate::api_response::MealHabitResponse;
use crate::auth::jwt::Claims;
use crate::models::CreateMealHabitRequest;
use crate::state::AppState;
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use plnd_data::Error;
use std::sync::Arc;
use uuid::Uuid;

pub const VALID_SLOTS: &[&str] = &["breakfast", "lunch", "dinner"];
pub const MAX_MEAL_NAME_LEN: usize = 100;
pub const MAX_RRULE_LEN: usize = 500;

#[utoipa::path(
    get,
    path = "/meal-habits",
    tag = "Meal Habits",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of meal habits", body = Vec<MealHabitResponse>),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn list_meal_habits(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<MealHabitResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .meal_habit
        .list_for_user(user_id)
        .await
        .map(|v| Json(v.into_iter().map(MealHabitResponse::from).collect()))
        .map_err(|e| {
            tracing::error!(error = %e, "list_meal_habits DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    post,
    path = "/meal-habits",
    tag = "Meal Habits",
    security(("bearer_auth" = [])),
    request_body = CreateMealHabitRequest,
    responses(
        (status = 201, description = "Meal habit created", body = MealHabitResponse),
        (status = 401, description = "Unauthorized"),
        (status = 409, description = "Duplicate meal habit"),
        (status = 422, description = "Validation error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn create_meal_habit(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateMealHabitRequest>,
) -> Result<(StatusCode, Json<MealHabitResponse>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if !VALID_SLOTS.contains(&body.slot.as_str()) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let meal_name = body.meal_name.trim().to_string();
    if meal_name.is_empty() || meal_name.len() > MAX_MEAL_NAME_LEN {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let recurrence_rule = body.recurrence_rule.trim().to_string();
    if recurrence_rule.is_empty() || recurrence_rule.len() > MAX_RRULE_LEN {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    state
        .repos
        .meal_habit
        .create(user_id, &meal_name, &body.slot, &recurrence_rule)
        .await
        .map(|h| (StatusCode::CREATED, Json(MealHabitResponse::from(h))))
        .map_err(|e| match e {
            Error::Conflict => StatusCode::CONFLICT,
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "create_meal_habit DB error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

#[utoipa::path(
    delete,
    path = "/meal-habits/{id}",
    tag = "Meal Habits",
    security(("bearer_auth" = [])),
    params(("id" = uuid::Uuid, Path, description = "Meal habit ID")),
    responses(
        (status = 204, description = "Meal habit deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Meal habit not found"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn delete_meal_habit(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(habit_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .meal_habit
        .delete(habit_id, user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "delete_meal_habit DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
        .and_then(|deleted| {
            if deleted {
                Ok(StatusCode::NO_CONTENT)
            } else {
                Err(StatusCode::NOT_FOUND)
            }
        })
}
