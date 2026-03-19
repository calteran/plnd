use std::sync::Arc;
use axum::{extract::State, http::StatusCode, Extension, Json};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::auth::jwt::Claims;
use crate::db::catalog_ingest;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct IngestIngredientBody {
    pub external_source: String,
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    pub serving_size_g: Option<Decimal>,
    pub nutrition: Option<Value>,
    pub allergens: Option<Vec<String>>,
    pub occasion_tags: Option<Vec<String>>,
}

#[derive(Serialize)]
pub struct IngestIngredientResponse {
    pub catalog_ingredient_id: Uuid,
}

pub async fn ingest_ingredient(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Json(body): Json<IngestIngredientBody>,
) -> Result<Json<IngestIngredientResponse>, StatusCode> {
    let allergens = body.allergens.unwrap_or_default();
    let occasion_tags = body.occasion_tags.unwrap_or_default();
    let id = catalog_ingest::ingest_ingredient(
        state.db.get_pool(),
        &body.external_source,
        &body.external_id,
        &body.name,
        body.description.as_deref(),
        body.serving_size_g,
        body.nutrition,
        &allergens,
        &occasion_tags,
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(IngestIngredientResponse {
        catalog_ingredient_id: id,
    }))
}
