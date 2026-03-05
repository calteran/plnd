use crate::db;
use crate::state::AppState;
use axum::{extract::State, http::StatusCode};
use std::collections::HashMap;
use std::sync::Arc;

pub async fn oauth_authorize(
    State(state): State<Arc<AppState>>,
) -> Result<axum::response::Redirect, StatusCode> {
    use crate::auth::oauth::OAuthProvider;
    let oauth_state = uuid::Uuid::new_v4().to_string();
    let auth_url = state
        .mock_provider
        .get_auth_url(&oauth_state, &state.callback_uri);
    Ok(axum::response::Redirect::to(&auth_url))
}

pub async fn oauth_callback(
    State(state): State<Arc<AppState>>,
    query: axum::extract::Query<HashMap<String, String>>,
) -> Result<axum::response::Redirect, StatusCode> {
    use crate::auth::oauth::OAuthProvider;

    let code = query.get("code").ok_or(StatusCode::BAD_REQUEST)?;

    let oauth_token = state
        .mock_provider
        .exchange_code_for_token(code, &state.callback_uri)
        .await
        .map_err(|e| {
            eprintln!("Token exchange failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let user_info = state
        .mock_provider
        .get_user_info(&oauth_token)
        .await
        .map_err(|e| {
            eprintln!("User info fetch failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let sub = &user_info.sub;
    let pool = state.db.get_pool();

    let user = match db::users::find_by_provider(pool, "mock", sub)
        .await
        .map_err(|e| {
            eprintln!("Provider lookup failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })? {
        Some(existing) => {
            let _ = db::users::touch_last_login(pool, existing.user_id).await;
            existing
        }
        None => {
            let email = user_info
                .email
                .clone()
                .unwrap_or_else(|| format!("{}@mock.plnd", sub));

            let user = match db::users::find_by_email(pool, &email).await.map_err(|e| {
                eprintln!("Email lookup failed: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })? {
                Some(existing) => {
                    let _ = db::users::touch_last_login(pool, existing.user_id).await;
                    existing
                }
                None => db::users::create(
                    pool,
                    &email,
                    user_info.name.as_deref(),
                    user_info.picture.as_deref(),
                )
                .await
                .map_err(|e| {
                    eprintln!("User creation failed: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?,
            };

            if let Err(e) = db::users::link_oauth_provider(pool, user.user_id, "mock", sub).await {
                eprintln!("Failed to link OAuth provider (non-fatal): {}", e);
            }

            user
        }
    };

    let jwt = state
        .jwt
        .generate_token(
            &user.user_id.to_string(),
            &user.email,
            user.display_name.as_deref(),
            user.profile_picture_url.as_deref(),
        )
        .map_err(|e| {
            eprintln!("JWT generation failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let token_hash = simple_hash(&jwt);

    let _session_id = state
        .session
        .create_session(&user.user_id.to_string(), &token_hash, None, None)
        .await
        .map_err(|e| {
            eprintln!("Session creation failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let redirect_url = format!("{}?token={}", state.frontend_callback, jwt);
    Ok(axum::response::Redirect::to(&redirect_url))
}

fn simple_hash(input: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    input.hash(&mut h);
    format!("{:016x}", h.finish())
}
