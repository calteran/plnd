use axum::{Extension, Json, extract::State, http::StatusCode};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::jwt::Claims;
use crate::state::AppState;
use plnd_data::repository::catalog_ingest::{ContributeIngredientInput, IngestIngredientInput};

#[derive(Deserialize, utoipa::ToSchema)]
pub struct IngestIngredientBody {
    pub external_source: String,
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    #[schema(value_type = Option<f64>)]
    pub serving_size_g: Option<Decimal>,
    #[schema(value_type = Option<Object>)]
    pub nutrition: Option<Value>,
    pub allergens: Option<Vec<String>>,
    pub occasion_tags: Option<Vec<String>>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct IngestIngredientResponse {
    pub catalog_ingredient_id: Uuid,
}

#[utoipa::path(
    post,
    path = "/catalog/ingredients/ingest",
    tag = "Catalog",
    request_body = IngestIngredientBody,
    security(("bearer_auth" = [])),
    responses(
        (status = 201, description = "Ingredient ingested into catalog", body = IngestIngredientResponse),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn ingest_ingredient(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Json(body): Json<IngestIngredientBody>,
) -> Result<(StatusCode, Json<IngestIngredientResponse>), StatusCode> {
    let id = state
        .repos
        .catalog_ingest
        .ingest_ingredient(IngestIngredientInput {
            external_source: body.external_source,
            external_id: body.external_id,
            name: body.name,
            description: body.description,
            serving_size_g: body.serving_size_g,
            nutrition: body.nutrition,
            allergens: body.allergens.unwrap_or_default(),
            occasion_tags: body.occasion_tags.unwrap_or_default(),
        })
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::CREATED,
        Json(IngestIngredientResponse {
            catalog_ingredient_id: id,
        }),
    ))
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct ContributeIngredientBody {
    pub name: String,
    pub allergens: Option<Vec<String>>,
    pub occasion_tags: Option<Vec<String>>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ContributeIngredientResponse {
    pub ingredient_id: Uuid,
}

#[utoipa::path(
    post,
    path = "/catalog/ingredients",
    tag = "Catalog",
    request_body = ContributeIngredientBody,
    security(("bearer_auth" = [])),
    responses(
        (status = 201, description = "User-contributed ingredient created", body = ContributeIngredientResponse),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Empty or whitespace-only name"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn contribute_ingredient(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<ContributeIngredientBody>,
) -> Result<(StatusCode, Json<ContributeIngredientResponse>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    let id = state
        .repos
        .catalog_ingest
        .contribute_ingredient(ContributeIngredientInput {
            name: name.to_string(),
            contributed_by_user_id: user_id,
            allergens: body.allergens.unwrap_or_default(),
            occasion_tags: body.occasion_tags.unwrap_or_default(),
        })
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::CREATED,
        Json(ContributeIngredientResponse { ingredient_id: id }),
    ))
}
