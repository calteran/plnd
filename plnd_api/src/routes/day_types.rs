use crate::api_response::DayTypeResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use chrono::{NaiveDate, NaiveTime};
use plnd_data::{Error, repository::day_type::DeleteDayTypeOutcome};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

pub const MAX_NAME_LEN: usize = 200;
/// Upper bound on `cycle_length`. Bound by the bit-width of `cycle_bitmask: i32`.
pub const MAX_CYCLE_LENGTH: i32 = 31;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateDayTypeRequest {
    pub name: String,
    pub days_bitmask: i32,
    #[serde(deserialize_with = "crate::models::deserialize_hhmm")]
    pub wake_time: NaiveTime,
    #[serde(deserialize_with = "crate::models::deserialize_hhmm")]
    pub sleep_time: NaiveTime,
    pub is_cycle: bool,
    pub cycle_length: Option<i32>,
    pub anchor_date: Option<NaiveDate>,
    /// Optional. For cycle types, low `cycle_length` bits indicate which
    /// positions in the cycle this day type covers; defaults to full coverage
    /// when omitted. Must be 0 (or omitted) for weekday types.
    pub cycle_bitmask: Option<i32>,
}

/// Kept separate from `CreateDayTypeRequest` so PUT and POST can diverge independently.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateDayTypeRequest {
    pub name: String,
    pub days_bitmask: i32,
    #[serde(deserialize_with = "crate::models::deserialize_hhmm")]
    pub wake_time: NaiveTime,
    #[serde(deserialize_with = "crate::models::deserialize_hhmm")]
    pub sleep_time: NaiveTime,
    pub is_cycle: bool,
    pub cycle_length: Option<i32>,
    pub anchor_date: Option<NaiveDate>,
    pub cycle_bitmask: Option<i32>,
}

/// Resolve the effective `cycle_bitmask` for a request:
/// - For cycle types: defaults to full coverage `(1 << cycle_length) - 1` when
///   the request omits the field. The existing day-types-substep UI does not
///   yet author partitioned cycles, so this default keeps the request
///   backward-compatible (issue #730).
/// - For weekday types: must be 0 or absent.
fn resolve_cycle_bitmask(is_cycle: bool, cycle_length: Option<i32>, requested: Option<i32>) -> i32 {
    if is_cycle {
        match requested {
            Some(v) => v,
            None => match cycle_length {
                Some(len) if (1..=MAX_CYCLE_LENGTH).contains(&len) => (1_i32 << len) - 1,
                _ => 0, // length will fail validation below; bitmask value is irrelevant
            },
        }
    } else {
        0
    }
}

/// Validate name length, mode XOR, cycle parameters, and cycle-bitmask range.
fn validate_day_type_request(
    name: &str,
    days_bitmask: i32,
    is_cycle: bool,
    cycle_length: Option<i32>,
    anchor_date: Option<NaiveDate>,
    cycle_bitmask: i32,
) -> Result<(), StatusCode> {
    if name.trim().is_empty() || name.trim().len() > MAX_NAME_LEN {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if is_cycle {
        // Cycle types must not carry a weekday bitmask.
        if days_bitmask != 0 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
        let length = match cycle_length {
            Some(l) if (1..=MAX_CYCLE_LENGTH).contains(&l) => l,
            _ => return Err(StatusCode::UNPROCESSABLE_ENTITY),
        };
        if anchor_date.is_none() {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
        // cycle_bitmask must be a non-zero value within the cycle's bit width.
        let max_bitmask = (1_i32 << length) - 1;
        if cycle_bitmask <= 0 || cycle_bitmask > max_bitmask {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    } else {
        if !(0..=127).contains(&days_bitmask) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
        if cycle_length.is_some() || anchor_date.is_some() {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
        if cycle_bitmask != 0 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    Ok(())
}

/// E.5: reject if the requested weekday bitmask overlaps with any existing
/// weekday day type for this user. Cycle types are checked separately.
async fn check_bitmask_no_overlap(
    state: &AppState,
    user_id: Uuid,
    days_bitmask: i32,
    exclude_id: Option<Uuid>,
) -> Result<(), StatusCode> {
    if days_bitmask == 0 {
        return Ok(());
    }
    let existing = state
        .repos
        .day_type
        .list_for_user(user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "overlap check: list_for_user failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    for dt in existing {
        if Some(dt.id) == exclude_id {
            continue;
        }
        if dt.days_bitmask & days_bitmask != 0 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    Ok(())
}

/// Reject if the requested mode (`is_cycle`) differs from any other day type
/// the user already has. A user is either weekday-only or cycle-only.
/// `exclude_id` skips the row being updated.
async fn check_mode_homogeneous(
    state: &AppState,
    user_id: Uuid,
    is_cycle: bool,
    exclude_id: Option<Uuid>,
) -> Result<(), StatusCode> {
    let existing = state
        .repos
        .day_type
        .list_for_user(user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "homogeneity check: list_for_user failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    for dt in existing {
        if Some(dt.id) == exclude_id {
            continue;
        }
        if dt.is_cycle != is_cycle {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    Ok(())
}

/// For cycle types: require all of the user's other cycle types to share the
/// same `cycle_length` and `anchor_date` (one cycle, partitioned among day
/// types) and to use disjoint `cycle_bitmask`s.
async fn check_cycle_group_consistent(
    state: &AppState,
    user_id: Uuid,
    cycle_length: i32,
    anchor_date: NaiveDate,
    cycle_bitmask: i32,
    exclude_id: Option<Uuid>,
) -> Result<(), StatusCode> {
    let existing = state
        .repos
        .day_type
        .list_for_user(user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "cycle group check: list_for_user failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    for dt in existing {
        if Some(dt.id) == exclude_id || !dt.is_cycle {
            continue;
        }
        if dt.cycle_length != Some(cycle_length) || dt.anchor_date != Some(anchor_date) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
        if dt.cycle_bitmask & cycle_bitmask != 0 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    Ok(())
}

#[utoipa::path(
    get,
    path = "/day-types",
    tag = "Day Types",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "List of day types", body = Vec<DayTypeResponse>),
        (status = 401, description = "Unauthorized"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn list_day_types(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<DayTypeResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .day_type
        .list_for_user(user_id)
        .await
        .map(|v| Json(v.into_iter().map(DayTypeResponse::from).collect()))
        .map_err(|e| {
            tracing::error!(error = %e, "list_day_types DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

#[utoipa::path(
    post,
    path = "/day-types",
    tag = "Day Types",
    security(("bearer_auth" = [])),
    request_body = CreateDayTypeRequest,
    responses(
        (status = 201, description = "Day type created", body = DayTypeResponse),
        (status = 401, description = "Unauthorized"),
        (status = 422, description = "Validation error or bitmask overlap"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn create_day_type(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateDayTypeRequest>,
) -> Result<(StatusCode, Json<DayTypeResponse>), StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let cycle_bitmask = resolve_cycle_bitmask(body.is_cycle, body.cycle_length, body.cycle_bitmask);

    validate_day_type_request(
        &body.name,
        body.days_bitmask,
        body.is_cycle,
        body.cycle_length,
        body.anchor_date,
        cycle_bitmask,
    )?;

    check_mode_homogeneous(&state, user_id, body.is_cycle, None).await?;
    check_bitmask_no_overlap(&state, user_id, body.days_bitmask, None).await?;
    if body.is_cycle {
        // Validation above guarantees these are Some.
        check_cycle_group_consistent(
            &state,
            user_id,
            body.cycle_length.unwrap(),
            body.anchor_date.unwrap(),
            cycle_bitmask,
            None,
        )
        .await?;
    }

    state
        .repos
        .day_type
        .create(
            user_id,
            body.name.trim(),
            body.days_bitmask,
            body.wake_time,
            body.sleep_time,
            body.is_cycle,
            body.cycle_length,
            body.anchor_date,
            cycle_bitmask,
        )
        .await
        .map(|dt| (StatusCode::CREATED, Json(DayTypeResponse::from(dt))))
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "create_day_type DB error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}

#[utoipa::path(
    put,
    path = "/day-types/{id}",
    tag = "Day Types",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Day type ID")),
    request_body = UpdateDayTypeRequest,
    responses(
        (status = 200, description = "Updated day type", body = DayTypeResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Day type not found"),
        (status = 422, description = "Validation error or bitmask overlap"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn update_day_type(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(day_type_id): Path<Uuid>,
    Json(body): Json<UpdateDayTypeRequest>,
) -> Result<Json<DayTypeResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let cycle_bitmask = resolve_cycle_bitmask(body.is_cycle, body.cycle_length, body.cycle_bitmask);

    validate_day_type_request(
        &body.name,
        body.days_bitmask,
        body.is_cycle,
        body.cycle_length,
        body.anchor_date,
        cycle_bitmask,
    )?;

    check_mode_homogeneous(&state, user_id, body.is_cycle, Some(day_type_id)).await?;
    check_bitmask_no_overlap(&state, user_id, body.days_bitmask, Some(day_type_id)).await?;
    if body.is_cycle {
        check_cycle_group_consistent(
            &state,
            user_id,
            body.cycle_length.unwrap(),
            body.anchor_date.unwrap(),
            cycle_bitmask,
            Some(day_type_id),
        )
        .await?;
    }

    state
        .repos
        .day_type
        .update(
            day_type_id,
            user_id,
            body.name.trim(),
            body.days_bitmask,
            body.wake_time,
            body.sleep_time,
            body.is_cycle,
            body.cycle_length,
            body.anchor_date,
            cycle_bitmask,
        )
        .await
        .map_err(|e| match e {
            Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
            e => {
                tracing::error!(error = %e, "update_day_type DB error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?
        .map(|dt| Json(DayTypeResponse::from(dt)))
        .ok_or(StatusCode::NOT_FOUND)
}

#[utoipa::path(
    delete,
    path = "/day-types/{id}",
    tag = "Day Types",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Day type ID")),
    responses(
        (status = 204, description = "Day type deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Day type not found"),
        (status = 422, description = "Cannot delete the last day type"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn delete_day_type(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(day_type_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    match state.repos.day_type.delete(day_type_id, user_id).await {
        Ok(DeleteDayTypeOutcome::Deleted) => Ok(StatusCode::NO_CONTENT),
        Ok(DeleteDayTypeOutcome::NotFound) => Err(StatusCode::NOT_FOUND),
        Ok(DeleteDayTypeOutcome::LastType) => Err(StatusCode::UNPROCESSABLE_ENTITY),
        Err(Error::ConnectionLost) => Err(StatusCode::SERVICE_UNAVAILABLE),
        Err(e) => {
            tracing::error!(error = %e, "delete_day_type DB error");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchor() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 5, 11).unwrap()
    }

    // ── resolve_cycle_bitmask ───────────────────────────────────────────────

    #[test]
    fn resolve_cycle_bitmask_uses_request_value_when_present() {
        assert_eq!(
            resolve_cycle_bitmask(true, Some(6), Some(0b000111)),
            0b000111
        );
    }

    #[test]
    fn resolve_cycle_bitmask_defaults_to_full_coverage_for_cycle() {
        assert_eq!(resolve_cycle_bitmask(true, Some(4), None), 0b1111);
        assert_eq!(resolve_cycle_bitmask(true, Some(7), None), 0b1111111);
    }

    #[test]
    fn resolve_cycle_bitmask_returns_zero_for_weekday_type() {
        assert_eq!(resolve_cycle_bitmask(false, None, None), 0);
        // Even if the client sends a value, weekday types ignore it (validator
        // will reject non-zero anyway).
        assert_eq!(resolve_cycle_bitmask(false, None, Some(0)), 0);
    }

    // ── validate_day_type_request ───────────────────────────────────────────

    #[test]
    fn validate_accepts_simple_weekday_type() {
        assert!(validate_day_type_request("Weekdays", 62, false, None, None, 0).is_ok());
    }

    #[test]
    fn validate_rejects_empty_or_long_name() {
        assert!(validate_day_type_request("", 62, false, None, None, 0).is_err());
        assert!(validate_day_type_request("   ", 62, false, None, None, 0).is_err());
        let long = "x".repeat(MAX_NAME_LEN + 1);
        assert!(validate_day_type_request(&long, 62, false, None, None, 0).is_err());
    }

    #[test]
    fn validate_rejects_weekday_type_with_cycle_fields() {
        assert!(validate_day_type_request("Weekdays", 62, false, Some(7), None, 0).is_err());
        assert!(validate_day_type_request("Weekdays", 62, false, None, Some(anchor()), 0).is_err());
        assert!(validate_day_type_request("Weekdays", 62, false, None, None, 1).is_err());
    }

    #[test]
    fn validate_rejects_weekday_bitmask_out_of_range() {
        assert!(validate_day_type_request("X", -1, false, None, None, 0).is_err());
        assert!(validate_day_type_request("X", 128, false, None, None, 0).is_err());
    }

    #[test]
    fn validate_accepts_cycle_with_partition_bitmask() {
        assert!(
            validate_day_type_request("Day", 0, true, Some(4), Some(anchor()), 0b0001).is_ok(),
            "single-position bitmask should pass"
        );
        assert!(
            validate_day_type_request("On3", 0, true, Some(6), Some(anchor()), 0b000111).is_ok(),
            "multi-position bitmask should pass"
        );
    }

    #[test]
    fn validate_rejects_cycle_missing_length_or_anchor() {
        assert!(validate_day_type_request("Cycle", 0, true, None, Some(anchor()), 0b1).is_err());
        assert!(validate_day_type_request("Cycle", 0, true, Some(4), None, 0b1).is_err());
    }

    #[test]
    fn validate_rejects_cycle_length_out_of_range() {
        assert!(validate_day_type_request("Cycle", 0, true, Some(0), Some(anchor()), 1).is_err());
        assert!(
            validate_day_type_request(
                "Cycle",
                0,
                true,
                Some(MAX_CYCLE_LENGTH + 1),
                Some(anchor()),
                1
            )
            .is_err()
        );
    }

    #[test]
    fn validate_rejects_cycle_with_nonzero_days_bitmask() {
        assert!(
            validate_day_type_request("Cycle", 1, true, Some(4), Some(anchor()), 0b0001).is_err()
        );
    }

    #[test]
    fn validate_rejects_cycle_bitmask_zero_or_overflow() {
        // Zero would mean "matches no dates" — disallowed.
        assert!(validate_day_type_request("Cycle", 0, true, Some(4), Some(anchor()), 0).is_err());
        // Bits beyond cycle_length are disallowed: length=4 → max bitmask = 0b1111.
        assert!(
            validate_day_type_request("Cycle", 0, true, Some(4), Some(anchor()), 0b10000).is_err()
        );
    }
}
