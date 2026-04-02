use crate::api_response::DietaryRestrictionResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use plnd_data::db;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
pub struct CreateRestrictionRequest {
    pub restriction_type: String,
    pub name: String,
    pub notes: Option<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
pub struct UpdateRestrictionRequest {
    pub notes: Option<String>,
}

pub const VALID_TYPES: &[&str] = &["allergy", "intolerance", "preference"];
pub const MAX_NAME_LEN: usize = 100;
pub const MAX_NOTES_LEN: usize = 500;

#[utoipa::path(
    get,
    path = "/dietary-restrictions",
    tag = "Dietary Restrictions",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of dietary restrictions", body = Vec<DietaryRestrictionResponse>),
        (status = 401, description = "Unauthorized"),
    )
)]
/// GET /dietary-restrictions — list all restrictions for the current user
pub async fn list_restrictions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<DietaryRestrictionResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::dietary_restrictions::list(pool, user_id)
        .await
        .map(|v| {
            Json(
                v.into_iter()
                    .map(DietaryRestrictionResponse::from)
                    .collect(),
            )
        })
        .map_err(|e| {
            tracing::error!(error = %e, "list_restrictions DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    post,
    path = "/dietary-restrictions",
    tag = "Dietary Restrictions",
    security(("bearer_auth" = [])),
    request_body = CreateRestrictionRequest,
    responses(
        (status = 201, description = "Restriction created", body = DietaryRestrictionResponse),
        (status = 401, description = "Unauthorized"),
        (status = 409, description = "Duplicate restriction (same type and name)"),
        (status = 422, description = "Validation error"),
    )
)]
/// POST /dietary-restrictions — create a new restriction
pub async fn create_restriction(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateRestrictionRequest>,
) -> Result<(StatusCode, Json<DietaryRestrictionResponse>), StatusCode> {
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
    .map(|r| {
        (
            StatusCode::CREATED,
            Json(DietaryRestrictionResponse::from(r)),
        )
    })
    .map_err(|e| match e {
        db::error::DatabaseError::UniqueViolation => StatusCode::CONFLICT,
        db::error::DatabaseError::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
        e => {
            tracing::error!(error = %e, "create_restriction DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })
}

#[utoipa::path(
    patch,
    path = "/dietary-restrictions/{id}",
    tag = "Dietary Restrictions",
    security(("bearer_auth" = [])),
    params(("id" = uuid::Uuid, Path, description = "Restriction ID")),
    request_body = UpdateRestrictionRequest,
    responses(
        (status = 200, description = "Updated restriction", body = DietaryRestrictionResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Restriction not found"),
        (status = 422, description = "Validation error"),
    )
)]
/// PATCH /dietary-restrictions/:id — update notes on an existing restriction
pub async fn update_restriction(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(restriction_id): Path<Uuid>,
    Json(body): Json<UpdateRestrictionRequest>,
) -> Result<Json<DietaryRestrictionResponse>, StatusCode> {
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
            tracing::error!(error = %e, "update_restriction DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .map(|r| Json(DietaryRestrictionResponse::from(r)))
        .ok_or(StatusCode::NOT_FOUND)
}

#[utoipa::path(
    delete,
    path = "/dietary-restrictions/{id}",
    tag = "Dietary Restrictions",
    security(("bearer_auth" = [])),
    params(("id" = uuid::Uuid, Path, description = "Restriction ID")),
    responses(
        (status = 204, description = "Restriction deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Restriction not found"),
    )
)]
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
            tracing::error!(error = %e, "delete_restriction DB error");
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
