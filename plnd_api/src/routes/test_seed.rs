//! Dev-only test seeding endpoint.
//!
//! The entire module is gated by `#[cfg(debug_assertions)]` in `routes/mod.rs`,
//! so the route is physically absent from release builds. It exists only to let
//! e2e tests put the calling user (identified by JWT) into a deterministic state
//! without resorting to `page.route()` mocks against the real backend.

use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
};
use chrono::NaiveTime;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SeedRequest {
    pub preset: Option<SeedPreset>,
    pub user: Option<UserSeed>,
    pub default_day_type: Option<bool>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum SeedPreset {
    Onboarded,
    New,
}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct UserSeed {
    pub onboarding_completed: Option<bool>,
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SeedResponse {
    pub user_id: Uuid,
}

#[derive(Debug, Default)]
struct ResolvedSeed {
    onboarding_completed: Option<bool>,
    display_name: Option<String>,
    default_day_type: bool,
}

impl ResolvedSeed {
    fn from_request(req: SeedRequest) -> Self {
        let mut resolved = match req.preset {
            Some(SeedPreset::Onboarded) => Self {
                onboarding_completed: Some(true),
                display_name: Some("Test User".to_string()),
                default_day_type: true,
            },
            Some(SeedPreset::New) => Self {
                onboarding_completed: Some(false),
                display_name: None,
                default_day_type: false,
            },
            None => Self::default(),
        };
        let user = req.user.unwrap_or_default();
        resolved.onboarding_completed = user.onboarding_completed.or(resolved.onboarding_completed);
        resolved.display_name = user.display_name.or(resolved.display_name);
        resolved.default_day_type = req.default_day_type.unwrap_or(resolved.default_day_type);
        resolved
    }
}

#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn post_seed(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SeedRequest>,
) -> Result<Json<SeedResponse>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let resolved = ResolvedSeed::from_request(body);

    if let Some(completed) = resolved.onboarding_completed {
        state
            .repos
            .user
            .set_onboarding_completed(user_id, completed)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "test_seed: set_onboarding_completed failed");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    }

    if let Some(name) = resolved.display_name.as_deref() {
        state
            .repos
            .user
            .update_profile(user_id, Some(name), None)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "test_seed: update_profile failed");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    }

    if resolved.default_day_type {
        ensure_default_day_type(&state, user_id).await?;
    }

    Ok(Json(SeedResponse { user_id }))
}

async fn ensure_default_day_type(state: &Arc<AppState>, user_id: Uuid) -> Result<(), StatusCode> {
    let existing = state
        .repos
        .day_type
        .list_for_user(user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "test_seed: list day_types failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    if !existing.is_empty() {
        return Ok(());
    }

    // Matches the dev_user seed in plnd_seed/src/dev_user.rs:84-110 so e2e and
    // `just dev` produce the same default shape. If those values change, update
    // both call sites.
    let day_type = state
        .repos
        .day_type
        .create(
            user_id,
            "Everyday",
            127, // all 7 days
            NaiveTime::from_hms_opt(7, 0, 0).expect("valid"),
            NaiveTime::from_hms_opt(22, 0, 0).expect("valid"),
            false,
            None,
            None,
            0,
        )
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "test_seed: create day_type failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let entries: &[(&str, u32, u32, i32)] = &[
        ("breakfast", 8, 0, 1),
        ("lunch", 12, 0, 2),
        ("dinner", 18, 0, 3),
    ];
    for (name, hh, mm, sort) in entries {
        state
            .repos
            .meal_pattern
            .create(
                day_type.id,
                name,
                NaiveTime::from_hms_opt(*hh, *mm, 0).expect("valid"),
                60,
                *sort,
            )
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "test_seed: create meal_pattern failed");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    }

    Ok(())
}
