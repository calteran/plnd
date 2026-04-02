---
title: DB Layer Migration — plnd_api → plnd_data
issue: https://github.com/calteran/plnd/issues/158
date: 2026-04-02
status: approved
---

# DB Layer Migration: `plnd_api` → `plnd_data`

## Summary

Move all database access logic from `plnd_api/src/db/` into `plnd_data/src/db/`, establishing `plnd_data` as the single owner of all data-at-rest concerns. This is a Phase 3 prerequisite — it enables `plnd_agent` to depend on `plnd_data` for DB access without pulling in HTTP routing or auth concerns.

## Target Dependency Graph

```
plnd_api  →  plnd_data
(routes,      (DB queries + DB models,
 auth,          external providers,
 API DTOs,      cache, search)
 utoipa)

Phase 3:
plnd_api  →  plnd_agent  →  plnd_data
```

`plnd_api` never holds a raw `PgPool` — it always accesses the database through `plnd_data`. `plnd_data` has zero knowledge of HTTP routing, auth, or OpenAPI documentation.

## What Moves into `plnd_data`

All 15 DB modules move verbatim into `plnd_data/src/db/`:

- `connection.rs` — `Database` struct wrapping `PgPool`
- `error.rs` — `DatabaseError` enum
- `models/mod.rs` — DB row structs (sqlx::FromRow types only — see below)
- `briefing.rs`, `catalog_details.rs`, `catalog_ingest.rs`, `dietary_restrictions.rs`, `preferences.rs`, `schedule.rs`, `search.rs`, `tasks.rs`, `user_dish_prefs.rs`, `user_ingredient_prefs.rs`, `user_meal_prefs.rs`, `users.rs`

**utoipa stripping:** Every `utoipa::ToSchema` derive and `utoipa` import is removed from all moved files. `plnd_data` does not depend on `utoipa`.

`plnd_data/src/lib.rs` gains `pub mod db;`.

## What Stays in `plnd_api`

### HTTP request/response types

The types currently in `db/models/mod.rs` that are HTTP concerns remain in `plnd_api`:

- `PatchPreferencesRequest`
- `PlanEntryRequest`, `PostSchedulePlanRequest`, `PostSchedulePlanResponse`
- `SchedulePeriodResponse`, `PlanStatusResponse`
- `CarryoverDecision`
- `deserialize_hhmm` helper

These move to a new `plnd_api/src/models.rs`, keeping them in one place for the routes that import them.

### API response wrapper types

Four new structs in `plnd_api` wrap the DB row types that `openapi.rs` registers, adding `ToSchema` at the API boundary:

- `UserResponse` wraps `plnd_data::db::models::User`
- `UserPreferencesResponse` wraps `plnd_data::db::models::UserPreferences`
- `DietaryRestrictionResponse` wraps `plnd_data::db::models::DietaryRestriction`
- `ReadyStatusResponse` wraps `plnd_data::db::models::ReadyStatus`

Each derives `#[derive(Serialize, utoipa::ToSchema)]` and implements `From<plnd_data_type>`.

Route handlers that currently return DB row types directly are updated to map through the wrapper at the response boundary (e.g., `.map(UserResponse::from)`).

## Cargo.toml Changes

**`plnd_data/Cargo.toml`** — add:
```toml
sqlx = { version = "0.8", features = ["postgres", "uuid", "chrono", "runtime-tokio", "migrate", "json", "rust_decimal"] }
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4", "serde"] }
rust_decimal = { version = "1", features = ["db-postgres"] }
```

**`plnd_api/Cargo.toml`** — remove:
```toml
sqlx = { ... }  # now transitive via plnd_data
```

Keep `uuid`, `chrono`, `rust_decimal` as direct deps in `plnd_api` (still needed for auth, config, request types).

## Data Flow Example

```
GET /me
  route handler
    → calls plnd_data::db::users::get_user(&pool, user_id)
    → returns plnd_data::db::models::User
    → handler: UserResponse::from(user)
    → axum serializes UserResponse (has ToSchema, no sqlx)
```

## Error Handling

`DatabaseError` moves to `plnd_data::db::error::DatabaseError` unchanged. Route handlers in `plnd_api` update import paths but no error mapping logic changes.

## Verification

This is a mechanical refactor — no behavior changes. Verification:

1. `just verify-build` — confirms compilation
2. `just test-ci` — confirms no regressions

No new tests are required.
