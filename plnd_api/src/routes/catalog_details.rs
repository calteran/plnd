use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::jwt::Claims;
use crate::db::{
    catalog_details,
    models::{CatalogDish, CatalogDishIngredient, CatalogIngredient, CatalogMeal, CatalogMealDish},
};
use crate::state::AppState;

#[derive(Serialize)]
pub struct DishDetailResponse {
    #[serde(flatten)]
    pub dish: CatalogDish,
    pub ingredients: Vec<CatalogDishIngredient>,
}

#[derive(Serialize)]
pub struct MealDetailResponse {
    #[serde(flatten)]
    pub meal: CatalogMeal,
    pub dishes: Vec<CatalogMealDish>,
}

pub async fn get_ingredient(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<CatalogIngredient>, StatusCode> {
    catalog_details::get_ingredient(state.db.get_pool(), id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

pub async fn get_dish(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<DishDetailResponse>, StatusCode> {
    let result = catalog_details::get_dish(state.db.get_pool(), id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    match result {
        None => Err(StatusCode::NOT_FOUND),
        Some((dish, ingredients)) => Ok(Json(DishDetailResponse { dish, ingredients })),
    }
}

pub async fn get_meal(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<MealDetailResponse>, StatusCode> {
    let result = catalog_details::get_meal(state.db.get_pool(), id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    match result {
        None => Err(StatusCode::NOT_FOUND),
        Some((meal, dishes)) => Ok(Json(MealDetailResponse { meal, dishes })),
    }
}
