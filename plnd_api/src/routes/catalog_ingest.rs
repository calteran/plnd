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
    pub ingredient_id: Uuid,
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
            // brand is populated only by the promote-path normalizer (#913), not via this direct-ingest body.
            brand: None,
        })
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::CREATED,
        Json(IngestIngredientResponse { ingredient_id: id }),
    ))
}

/// Resolve the `(name, brand)` to persist for a promoted ingredient.
///
/// Canonical sources (USDA Foundation/SR Legacy) already carry clean names, so
/// they bypass normalization. Branded sources are split via the normalizer and
/// passed through the confidence gate; any failure keeps the original name.
pub(crate) async fn resolve_name_brand(
    is_canonical: bool,
    original_name: &str,
    normalizer: &dyn plnd_agent::BrandNormalizer,
) -> (String, Option<String>) {
    if is_canonical {
        return (original_name.to_string(), None);
    }
    let (name, brand) = match normalizer.normalize(original_name).await {
        Some(n) => n.gated(original_name),
        None => (original_name.to_string(), None),
    };
    tracing::debug!(
        original_name,
        resolved_name = %name,
        brand = ?brand,
        "brand normalization resolved for branded source"
    );
    (name, brand)
}

/// Map a provider's full ingredient detail into the catalog ingest input.
/// Nutrition is serialized to JSON; a serialization failure degrades to `None`
/// rather than failing the whole promotion.
pub(crate) fn ingest_input_from_detail(
    external_source: &str,
    detail: plnd_data::providers::dtos::ExternalIngredient,
    name: String,
    brand: Option<String>,
) -> IngestIngredientInput {
    IngestIngredientInput {
        external_source: external_source.to_string(),
        external_id: detail.external_id,
        name,
        description: None,
        serving_size_g: detail.serving_size_g,
        nutrition: detail
            .nutrition
            .as_ref()
            .and_then(|n| serde_json::to_value(n).ok()),
        allergens: detail.allergens,
        // Provider-promoted ingredients carry no occasion data: a food category
        // is a taxonomy, not an occasion (#921). Occasion tags on an ingredient
        // come only from explicit user input via the manual ingest/contribute APIs.
        occasion_tags: vec![],
        brand,
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct PromoteIngredientBody {
    pub external_source: String,
    pub external_id: String,
}

#[utoipa::path(
    post,
    path = "/catalog/ingredients/promote",
    tag = "Catalog",
    request_body = PromoteIngredientBody,
    security(("bearer_auth" = [])),
    responses(
        (status = 201, description = "External ingredient promoted into catalog", body = IngestIngredientResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "No provider matched source, or external id not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(external_source = %body.external_source, external_id = %body.external_id))]
pub async fn promote_ingredient(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Json(body): Json<PromoteIngredientBody>,
) -> Result<(StatusCode, Json<IngestIngredientResponse>), StatusCode> {
    let detail = state
        .provider_search
        .fetch_ingredient_detail(&body.external_source, &body.external_id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    let is_canonical = state
        .provider_search
        .is_canonical_source(&body.external_source);
    let (name, brand) =
        resolve_name_brand(is_canonical, &detail.name, state.brand_normalizer.as_ref()).await;
    let id = state
        .repos
        .catalog_ingest
        .ingest_ingredient(ingest_input_from_detail(
            &body.external_source,
            detail,
            name,
            brand,
        ))
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "promote_ingredient ingest error");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok((
        StatusCode::CREATED,
        Json(IngestIngredientResponse { ingredient_id: id }),
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
        (status = 422, description = "Name is empty, whitespace-only, or exceeds 200 characters"),
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
    const MAX_NAME_LEN: usize = 200;
    if name.chars().count() > MAX_NAME_LEN {
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

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn ingest_response_serializes_ingredient_id_field() {
        let ingredient_id = Uuid::new_v4();
        let resp = IngestIngredientResponse { ingredient_id };
        let v = serde_json::to_value(&resp).expect("serialize");
        assert_eq!(v, serde_json::json!({ "ingredient_id": ingredient_id }));
    }

    #[test]
    fn contribute_response_serializes_ingredient_id_field() {
        let ingredient_id = Uuid::new_v4();
        let resp = ContributeIngredientResponse { ingredient_id };
        let v = serde_json::to_value(&resp).expect("serialize");
        assert_eq!(v, serde_json::json!({ "ingredient_id": ingredient_id }));
    }

    #[test]
    fn ingest_input_from_detail_maps_nutrition_and_ids() {
        use plnd_data::providers::dtos::ExternalIngredient;
        let detail = ExternalIngredient {
            external_id: "173945".into(),
            name: "Bananas, dehydrated, or banana powder".into(),
            serving_size_g: None,
            nutrition: None,
            allergens: vec!["none".into()],
        };
        let input = ingest_input_from_detail(
            "usda_fdc",
            detail,
            "Bananas, dehydrated, or banana powder".to_string(),
            None,
        );
        assert_eq!(input.external_source, "usda_fdc");
        assert_eq!(input.external_id, "173945");
        assert_eq!(input.name, "Bananas, dehydrated, or banana powder");
        assert_eq!(input.allergens, vec!["none".to_string()]);
        assert_eq!(input.brand, None);
    }

    #[test]
    fn ingest_input_from_detail_serializes_populated_nutrition() {
        use plnd_data::providers::dtos::{ExternalIngredient, NutritionFacts};
        let detail = ExternalIngredient {
            external_id: "173945".into(),
            name: "Bananas, dehydrated, or banana powder".into(),
            serving_size_g: None,
            nutrition: Some(NutritionFacts {
                calories_kcal: Some(346.0),
                protein_g: Some(3.89),
                ..Default::default()
            }),
            allergens: vec![],
        };
        let input = ingest_input_from_detail(
            "usda_fdc",
            detail,
            "Bananas, dehydrated, or banana powder".to_string(),
            None,
        );
        let nutrition = input.nutrition.expect("nutrition serialized to Some");
        assert!(
            nutrition.get("calories_kcal").is_some(),
            "serialized nutrition JSON should contain calories_kcal: {nutrition}"
        );
        assert_eq!(nutrition.get("calories_kcal").unwrap(), 346.0);
    }

    // FixtureBrandNormalizer is debug-only (#[cfg(debug_assertions)]), so the
    // shared helper and the resolve_* tests below are gated to match.
    #[cfg(debug_assertions)]
    fn fixture_normalizer() -> plnd_agent::FixtureBrandNormalizer {
        use plnd_agent::{FixtureBrandNormalizer, Normalization};
        use std::collections::HashMap;
        let mut map = HashMap::new();
        map.insert(
            "Great Value Shredded Cheddar Cheese".to_string(),
            Normalization {
                generic_name: "Cheddar cheese".into(),
                brand: Some("Great Value".into()),
                confidence: 0.95,
            },
        );
        FixtureBrandNormalizer::from_entries(map)
    }

    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn resolve_skips_normalization_for_canonical_source() {
        let norm = fixture_normalizer();
        let (name, brand) = resolve_name_brand(true, "Cheddar cheese, low moisture", &norm).await;
        assert_eq!(name, "Cheddar cheese, low moisture");
        assert_eq!(brand, None);
    }

    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn resolve_splits_branded_source() {
        let norm = fixture_normalizer();
        let (name, brand) =
            resolve_name_brand(false, "Great Value Shredded Cheddar Cheese", &norm).await;
        assert_eq!(name, "Cheddar cheese");
        assert_eq!(brand.as_deref(), Some("Great Value"));
    }

    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn resolve_keeps_original_when_no_fixture_entry() {
        let norm = fixture_normalizer();
        let (name, brand) = resolve_name_brand(false, "Unmapped Branded Thing", &norm).await;
        assert_eq!(name, "Unmapped Branded Thing");
        assert_eq!(brand, None);
    }
}
