//! HTTP routes for timezone anchor management.
//!
//! All endpoints are authenticated and scoped to the requesting user. Storage
//! operations go exclusively through `Repositories.timezone_anchor`; there is
//! no direct sqlx usage in this module.
//!
//! Endpoints:
//! - `GET  /timezone/anchors?through=<YYYY-MM-DD>` — list anchors in window.
//! - `GET  /timezone/resolve?at=<YYYY-MM-DD>[&time=<HH:MM>]` — server-side resolution.
//! - `POST /timezone/anchors` — create a `user`-source anchor.
//! - `DELETE /timezone/anchors/{id}` — delete a single anchor.
//! - `DELETE /timezone/anchors/group/{inference_group}` — delete a whole group.

use crate::api_response::TimezoneAnchorResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
};
use chrono::{NaiveDate, NaiveTime};
use plnd_data::Error;
use plnd_data::models::TimezoneSource;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

/// Query for `GET /timezone/anchors`.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ListAnchorsQuery {
    /// Upper-bound date (inclusive). Returns anchors with `effective_date <= through`.
    pub through: NaiveDate,
}

/// Query for `GET /timezone/resolve`.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ResolveQuery {
    /// The date to resolve the timezone for.
    pub at: NaiveDate,
    /// Optional wall-clock time (`HH:MM`). When absent the whole-day resolution
    /// is used (consistent with how `zone_at` handles `time = None`).
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub time: Option<NaiveTime>,
}

fn deserialize_opt_hhmm<'de, D>(deserializer: D) -> Result<Option<NaiveTime>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: Option<String> = Option::deserialize(deserializer)?;
    match s {
        None => Ok(None),
        Some(s) => NaiveTime::parse_from_str(&s, "%H:%M")
            .or_else(|_| NaiveTime::parse_from_str(&s, "%H:%M:%S"))
            .map(Some)
            .map_err(serde::de::Error::custom),
    }
}

/// Response for `GET /timezone/resolve`.
///
/// `zone` is the IANA timezone name (e.g. `"America/Denver"`) or `null` when
/// no anchor exists at or before the query point. Using `null` rather than
/// omitting the field matches the `Option<T>` serialization convention used
/// throughout this codebase (serde default — present-but-null rather than
/// absent).
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ResolveResponse {
    /// IANA timezone name, or `null` if no anchor covers the requested point.
    pub zone: Option<String>,
}

/// Request body for `POST /timezone/anchors`.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateTimezoneAnchorRequest {
    /// Date from which this timezone is in effect.
    pub effective_date: NaiveDate,
    /// Optional wall-clock time within `effective_date` when the change takes
    /// effect (e.g. for a mid-day flight landing). `null` means the whole day.
    #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
    pub effective_time: Option<NaiveTime>,
    /// IANA timezone name (e.g. `"America/New_York"`). Must parse as a valid
    /// `chrono_tz::Tz`; unknown values are rejected with HTTP 400.
    pub zone: String,
    /// Optional ID of the originating record (e.g. a travel event). Stored as
    /// provided; has no effect on the `source` field (always forced to `user`).
    pub source_ref: Option<Uuid>,
    /// Optional group ID for batched inference invalidation. Accepted for API
    /// symmetry; typically `null` for user-created anchors.
    pub inference_group: Option<Uuid>,
}

/// Response body for the group-delete endpoint.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeleteGroupResponse {
    /// Number of anchors that were deleted.
    pub deleted: u64,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// List timezone anchors up to (and including) `through`.
///
/// Returns the user's anchors with `effective_date <= through`, ordered
/// ascending by `(effective_date, effective_time)`. The client uses this set
/// to resolve per-day zones locally with `zone_at`.
#[utoipa::path(
    get,
    path = "/timezone/anchors",
    tag = "Timezone",
    security(("bearer_auth" = [])),
    params(ListAnchorsQuery),
    responses(
        (status = 200, description = "Anchors up to `through`", body = Vec<TimezoneAnchorResponse>),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub, through = %query.through))]
pub async fn list_anchors(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ListAnchorsQuery>,
) -> Result<Json<Vec<TimezoneAnchorResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .timezone_anchor
        .list_through(user_id, query.through)
        .await
        .map(|v| Json(v.into_iter().map(TimezoneAnchorResponse::from).collect()))
        .map_err(|e| {
            tracing::error!(error = %e, "list_timezone_anchors error");
            map_repo_error(e)
        })
}

/// Resolve the timezone in effect at a given date (and optional time).
///
/// Loads anchors through `at` via `list_through`, then calls
/// `plnd_data::timezone::zone_at` to find the applicable zone. Returns
/// `{ "zone": "<IANA name>" }` or `{ "zone": null }` when no anchor covers
/// the requested point.
#[utoipa::path(
    get,
    path = "/timezone/resolve",
    tag = "Timezone",
    security(("bearer_auth" = [])),
    params(ResolveQuery),
    responses(
        (status = 200, description = "Timezone at the requested point (zone may be null)", body = ResolveResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub, at = %query.at))]
pub async fn resolve_zone(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ResolveQuery>,
) -> Result<Json<ResolveResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let anchors = state
        .repos
        .timezone_anchor
        .list_through(user_id, query.at)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "resolve_zone: list_through error");
            map_repo_error(e)
        })?;

    let zone = plnd_data::timezone::zone_at(&anchors, query.at, query.time)
        .map(|tz| tz.name().to_string());

    Ok(Json(ResolveResponse { zone }))
}

/// Create a user-source timezone anchor.
///
/// The `source` field is always forced to `TimezoneSource::User` regardless of
/// the request body; inferred anchors are created by the agent, not this
/// endpoint. The `zone` must be a valid IANA timezone name.
#[utoipa::path(
    post,
    path = "/timezone/anchors",
    tag = "Timezone",
    security(("bearer_auth" = [])),
    request_body = CreateTimezoneAnchorRequest,
    responses(
        (status = 201, description = "Anchor created", body = TimezoneAnchorResponse),
        (status = 400, description = "Invalid zone name"),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn create_anchor(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateTimezoneAnchorRequest>,
) -> Result<(StatusCode, Json<TimezoneAnchorResponse>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Validate the IANA zone name before touching the DB.
    let tz: chrono_tz::Tz = body.zone.parse().map_err(|_| {
        tracing::warn!(zone = %body.zone, "create_anchor: invalid IANA timezone");
        StatusCode::BAD_REQUEST
    })?;

    state
        .repos
        .timezone_anchor
        .add(
            user_id,
            body.effective_date,
            body.effective_time,
            tz,
            TimezoneSource::User,
            body.source_ref,
            body.inference_group,
        )
        .await
        .map(|anchor| (StatusCode::CREATED, Json(TimezoneAnchorResponse::from(anchor))))
        .map_err(|e| {
            tracing::error!(error = %e, "create_anchor error");
            map_repo_error(e)
        })
}

/// Delete a single timezone anchor (user-scoped).
///
/// Returns 404 if the anchor does not exist or belongs to another user.
#[utoipa::path(
    delete,
    path = "/timezone/anchors/{id}",
    tag = "Timezone",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Anchor ID")),
    responses(
        (status = 204, description = "Anchor deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found or not owned by this user"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub, id = %id))]
pub async fn delete_anchor(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let deleted = state
        .repos
        .timezone_anchor
        .delete(id, user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "delete_anchor error");
            map_repo_error(e)
        })?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

/// Delete all timezone anchors in an inference group (user-scoped).
///
/// Returns the count of deleted rows. Returns 200 with `{ "deleted": 0 }` if
/// the group does not exist or belongs to another user.
#[utoipa::path(
    delete,
    path = "/timezone/anchors/group/{inference_group}",
    tag = "Timezone",
    security(("bearer_auth" = [])),
    params(("inference_group" = Uuid, Path, description = "Inference group ID")),
    responses(
        (status = 200, description = "Group deleted; count of removed rows", body = DeleteGroupResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub, inference_group = %inference_group))]
pub async fn delete_anchor_group(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(inference_group): Path<Uuid>,
) -> Result<Json<DeleteGroupResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let deleted = state
        .repos
        .timezone_anchor
        .delete_group(user_id, inference_group)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "delete_anchor_group error");
            map_repo_error(e)
        })?;

    Ok(Json(DeleteGroupResponse { deleted }))
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

fn map_repo_error(e: Error) -> StatusCode {
    match e {
        Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
        e => {
            tracing::error!(error = %e, "timezone repo error");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests (no DB required)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_response_serializes_zone_as_string() {
        let resp = ResolveResponse {
            zone: Some("America/Denver".to_string()),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"zone\":\"America/Denver\""));
    }

    #[test]
    fn resolve_response_serializes_null_zone() {
        let resp = ResolveResponse { zone: None };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"zone\":null"));
    }

    #[test]
    fn create_anchor_request_deserializes_minimal() {
        let json = r#"{
            "effective_date": "2026-06-15",
            "zone": "America/New_York"
        }"#;
        let req: CreateTimezoneAnchorRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.effective_date.to_string(), "2026-06-15");
        assert_eq!(req.zone, "America/New_York");
        assert!(req.effective_time.is_none());
        assert!(req.source_ref.is_none());
        assert!(req.inference_group.is_none());
    }

    #[test]
    fn create_anchor_request_deserializes_full() {
        let group = Uuid::new_v4();
        let src_ref = Uuid::new_v4();
        let json = format!(
            r#"{{
                "effective_date": "2026-06-15",
                "effective_time": "14:30",
                "zone": "America/Denver",
                "source_ref": "{src_ref}",
                "inference_group": "{group}"
            }}"#
        );
        let req: CreateTimezoneAnchorRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req.effective_time, Some(NaiveTime::from_hms_opt(14, 30, 0).unwrap()));
        assert_eq!(req.source_ref, Some(src_ref));
        assert_eq!(req.inference_group, Some(group));
    }

    #[test]
    fn create_anchor_request_rejects_missing_zone() {
        let json = r#"{"effective_date": "2026-06-15"}"#;
        let result: Result<CreateTimezoneAnchorRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn deserialize_opt_hhmm_accepts_hhmm() {
        #[derive(Deserialize)]
        struct T {
            #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
            t: Option<NaiveTime>,
        }
        let v: T = serde_json::from_str(r#"{"t": "09:15"}"#).unwrap();
        assert_eq!(v.t, Some(NaiveTime::from_hms_opt(9, 15, 0).unwrap()));
    }

    #[test]
    fn deserialize_opt_hhmm_accepts_absent() {
        #[derive(Deserialize)]
        struct T {
            #[serde(default, deserialize_with = "deserialize_opt_hhmm")]
            t: Option<NaiveTime>,
        }
        let v: T = serde_json::from_str(r#"{}"#).unwrap();
        assert!(v.t.is_none());
    }

    #[test]
    fn delete_group_response_serializes() {
        let resp = DeleteGroupResponse { deleted: 3 };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"deleted\":3"));
    }
}
