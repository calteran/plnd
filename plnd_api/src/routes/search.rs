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

#[derive(Deserialize)]
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

#[derive(Serialize, Default)]
pub struct IngredientSearchResponse {
    pub local: Vec<LocalIngredientResult>,
    pub external: Vec<SearchResult>,
    pub providers_queried: Vec<String>,
    pub providers_from_cache: Vec<String>,
}

#[derive(Serialize, Default)]
pub struct DishSearchResponse {
    pub local: Vec<LocalDishResult>,
    pub user: Vec<LocalDishResult>,
    pub external: Vec<SearchResult>,
    pub providers_queried: Vec<String>,
    pub providers_from_cache: Vec<String>,
}

#[derive(Serialize, Default)]
pub struct ExerciseSearchResponse {
    pub local: Vec<LocalExerciseResult>,
    pub external: Vec<SearchResult>,
    pub providers_queried: Vec<String>,
    pub providers_from_cache: Vec<String>,
}

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
    .unwrap_or_default();

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

pub async fn search_dishes_handler(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SearchParams>,
) -> Result<Json<DishSearchResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let sq = params.into_search_query();
    let local = search_dishes(state.db.get_pool(), &sq.query, sq.limit as i64)
        .await
        .unwrap_or_default();
    let user = search_user_dishes(state.db.get_pool(), user_id, &sq.query, sq.limit as i64)
        .await
        .unwrap_or_default();

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

pub async fn search_exercises_handler(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<SearchParams>,
) -> Result<Json<ExerciseSearchResponse>, StatusCode> {
    let sq = params.into_search_query();
    let local = search_exercises(state.db.get_pool(), &sq.query, sq.limit as i64)
        .await
        .unwrap_or_default();

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
