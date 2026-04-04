use std::sync::Arc;

use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::jwt::Claims;
use crate::state::AppState;
use plnd_data::db::search::{
    search_dishes, search_exercises, search_ingredients, search_user_dishes, LocalDishResult,
    LocalExerciseResult, LocalIngredientResult,
};
use plnd_data::providers::dtos::{SearchQuery, SearchResult};
use plnd_data::search::ProviderSearchEvent;

fn default_limit() -> u32 {
    20
}

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    pub q: String,
    #[serde(default = "default_limit")]
    pub limit: u32,
    pub exclude_allergens: Option<String>,
}

impl SearchParams {
    fn into_search_query(self) -> SearchQuery {
        let exclude_allergens = self
            .exclude_allergens
            .as_deref()
            .unwrap_or("")
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        SearchQuery {
            query: self.q,
            limit: self.limit,
            exclude_allergens,
        }
    }
}

#[derive(Deserialize)]
pub struct ExerciseSearchParams {
    pub q: String,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

impl ExerciseSearchParams {
    fn into_search_query(self) -> SearchQuery {
        SearchQuery {
            query: self.q,
            limit: self.limit,
            exclude_allergens: vec![],
        }
    }
}

#[derive(Serialize, Default, utoipa::ToSchema)]
pub struct IngredientSearchResponse {
    #[schema(value_type = Vec<Object>)]
    pub local: Vec<LocalIngredientResult>,
    #[schema(value_type = Vec<Object>)]
    pub external: Vec<SearchResult>,
    pub providers_queried: Vec<String>,
    pub providers_from_cache: Vec<String>,
}

#[derive(Serialize, Default, utoipa::ToSchema)]
pub struct DishSearchResponse {
    #[schema(value_type = Vec<Object>)]
    pub local: Vec<LocalDishResult>,
    #[schema(value_type = Vec<Object>)]
    pub user: Vec<LocalDishResult>,
    #[schema(value_type = Vec<Object>)]
    pub external: Vec<SearchResult>,
    pub providers_queried: Vec<String>,
    pub providers_from_cache: Vec<String>,
}

#[derive(Serialize, Default, utoipa::ToSchema)]
pub struct ExerciseSearchResponse {
    #[schema(value_type = Vec<Object>)]
    pub local: Vec<LocalExerciseResult>,
    #[schema(value_type = Vec<Object>)]
    pub external: Vec<SearchResult>,
    pub providers_queried: Vec<String>,
    pub providers_from_cache: Vec<String>,
}

#[utoipa::path(
    get,
    path = "/search/ingredients",
    tag = "Search",
    params(
        ("q" = String, Query, description = "Search query"),
        ("limit" = Option<u32>, Query, description = "Max results (default 20)"),
        ("exclude_allergens" = Option<String>, Query, description = "Comma-separated allergens to exclude"),
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Ingredient search results", body = IngredientSearchResponse),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn search_ingredients_handler(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SearchParams>,
) -> Result<Json<IngredientSearchResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let sq = params.into_search_query();
    let local = search_ingredients(
        state.db.get_pool(),
        &sq.query,
        sq.limit as i64,
        &sq.exclude_allergens,
        Some(user_id),
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut stream = state.provider_search.search_ingredients(sq);
    let mut resp = IngredientSearchResponse {
        local,
        ..Default::default()
    };
    while let Some(ev) = stream.next().await {
        match ev {
            ProviderSearchEvent::Results { results, .. } => resp.external.extend(results),
            ProviderSearchEvent::Done {
                providers_queried,
                providers_from_cache,
            } => {
                resp.providers_queried = providers_queried;
                resp.providers_from_cache = providers_from_cache;
            }
            ProviderSearchEvent::Error { .. } => {}
        }
    }
    Ok(Json(resp))
}

#[utoipa::path(
    get,
    path = "/search/dishes",
    tag = "Search",
    params(
        ("q" = String, Query, description = "Search query"),
        ("limit" = Option<u32>, Query, description = "Max results (default 20)"),
        ("exclude_allergens" = Option<String>, Query, description = "Comma-separated allergens to exclude"),
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Dish search results", body = DishSearchResponse),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn search_dishes_handler(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SearchParams>,
) -> Result<Json<DishSearchResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let sq = params.into_search_query();
    let local = search_dishes(state.db.get_pool(), &sq.query, sq.limit as i64)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let user = search_user_dishes(state.db.get_pool(), user_id, &sq.query, sq.limit as i64)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut stream = state.provider_search.search_dishes(sq);
    let mut resp = DishSearchResponse {
        local,
        user,
        ..Default::default()
    };
    while let Some(ev) = stream.next().await {
        match ev {
            ProviderSearchEvent::Results { results, .. } => resp.external.extend(results),
            ProviderSearchEvent::Done {
                providers_queried,
                providers_from_cache,
            } => {
                resp.providers_queried = providers_queried;
                resp.providers_from_cache = providers_from_cache;
            }
            ProviderSearchEvent::Error { .. } => {}
        }
    }
    Ok(Json(resp))
}

#[utoipa::path(
    get,
    path = "/search/exercises",
    tag = "Search",
    params(
        ("q" = String, Query, description = "Search query"),
        ("limit" = Option<u32>, Query, description = "Max results (default 20)"),
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Exercise search results", body = ExerciseSearchResponse),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn search_exercises_handler(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<ExerciseSearchParams>,
) -> Result<Json<ExerciseSearchResponse>, StatusCode> {
    let sq = params.into_search_query();
    let local = search_exercises(state.db.get_pool(), &sq.query, sq.limit as i64)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut stream = state.provider_search.search_exercises(sq);
    let mut resp = ExerciseSearchResponse {
        local,
        ..Default::default()
    };
    while let Some(ev) = stream.next().await {
        match ev {
            ProviderSearchEvent::Results { results, .. } => resp.external.extend(results),
            ProviderSearchEvent::Done {
                providers_queried,
                providers_from_cache,
            } => {
                resp.providers_queried = providers_queried;
                resp.providers_from_cache = providers_from_cache;
            }
            ProviderSearchEvent::Error { .. } => {}
        }
    }
    Ok(Json(resp))
}
