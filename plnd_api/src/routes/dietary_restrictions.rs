use crate::auth::jwt::Claims;
use crate::db;
use crate::db::models::DietaryRestriction;
use crate::state::AppState;
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, serde::Deserialize)]
pub struct CreateRestrictionRequest {
    pub restriction_type: String,
    pub name: String,
    pub notes: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateRestrictionRequest {
    pub notes: Option<String>,
}

pub const VALID_TYPES: &[&str] = &["allergy", "intolerance", "preference"];
pub const MAX_NAME_LEN: usize = 100;
pub const MAX_NOTES_LEN: usize = 500;

/// GET /dietary-restrictions — list all restrictions for the current user
pub async fn list_restrictions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<DietaryRestriction>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::dietary_restrictions::list(pool, user_id)
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("list_restrictions DB error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

/// POST /dietary-restrictions — create a new restriction
pub async fn create_restriction(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateRestrictionRequest>,
) -> Result<(StatusCode, Json<DietaryRestriction>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if !VALID_TYPES.contains(&body.restriction_type.as_str()) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    let name = body.name.trim().to_lowercase();
    if name.is_empty() || name.len() > MAX_NAME_LEN {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    if let Some(ref n) = body.notes {
        if n.len() > MAX_NOTES_LEN {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }

    let pool = state.db.get_pool();

    db::dietary_restrictions::create(
        pool,
        user_id,
        &body.restriction_type,
        &name,
        body.notes.as_deref(),
    )
    .await
    .map(|r| (StatusCode::CREATED, Json(r)))
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("uq_user_type_name") {
            StatusCode::CONFLICT
        } else {
            eprintln!("create_restriction DB error: {}", msg);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })
}

/// PATCH /dietary-restrictions/:id — update notes on an existing restriction
pub async fn update_restriction(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(restriction_id): Path<Uuid>,
    Json(body): Json<UpdateRestrictionRequest>,
) -> Result<Json<DietaryRestriction>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    if let Some(ref n) = body.notes {
        if n.len() > MAX_NOTES_LEN {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }

    let pool = state.db.get_pool();

    db::dietary_restrictions::update(pool, restriction_id, user_id, body.notes.as_deref())
        .await
        .map_err(|e| {
            eprintln!("update_restriction DB error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// DELETE /dietary-restrictions/:id — remove a restriction
pub async fn delete_restriction(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(restriction_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::dietary_restrictions::delete(pool, restriction_id, user_id)
        .await
        .map_err(|e| {
            eprintln!("delete_restriction DB error: {}", e);
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
