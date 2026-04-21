use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::api_response::{
    CatalogIngredientResponse, DishDetailApiResponse, MealDetailApiResponse,
};
use crate::auth::jwt::Claims;
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/catalog/ingredients/{id}",
    tag = "Catalog",
    params(
        ("id" = Uuid, Path, description = "Catalog ingredient ID")
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Ingredient details", body = CatalogIngredientResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn get_ingredient(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<CatalogIngredientResponse>, StatusCode> {
    state
        .repos
        .meal
        .catalog_ingredient(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(CatalogIngredientResponse::from)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

#[utoipa::path(
    get,
    path = "/catalog/dishes/{id}",
    tag = "Catalog",
    params(
        ("id" = Uuid, Path, description = "Catalog dish ID")
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Dish details with ingredients", body = DishDetailApiResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn get_dish(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<DishDetailApiResponse>, StatusCode> {
    match state
        .repos
        .meal
        .catalog_dish(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        None => Err(StatusCode::NOT_FOUND),
        Some(pair) => Ok(Json(DishDetailApiResponse::from(pair))),
    }
}

#[utoipa::path(
    get,
    path = "/catalog/meals/{id}",
    tag = "Catalog",
    params(
        ("id" = Uuid, Path, description = "Catalog meal ID")
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Meal details with dishes", body = MealDetailApiResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn get_meal(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<MealDetailApiResponse>, StatusCode> {
    match state
        .repos
        .meal
        .catalog_meal(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        None => Err(StatusCode::NOT_FOUND),
        Some(pair) => Ok(Json(MealDetailApiResponse::from(pair))),
    }
}
