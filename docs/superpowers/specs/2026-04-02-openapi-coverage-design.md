---
title: Complete OpenAPI Coverage
date: 2026-04-02
issue: https://github.com/calteran/plnd/issues/173
status: approved
---

# Complete OpenAPI Coverage

## Problem

`plnd_api/src/openapi.rs` only registers 17 of ~45 route handlers. The Phase 2 routes (schedule, tasks, search, catalog, personal libraries) were implemented but never wired into the OpenAPI spec. The missing `#[utoipa::path]` annotations were scrubbed as dead code in PR #158 (DB layer migration).

As a result, the Scalar/Swagger UI is missing 28 endpoints.

## Solution

Add `#[utoipa::path]` annotations to all 28 unregistered handlers and register them in `openapi.rs`.

## Design Decision: ToSchema Strategy

The plnd_data types returned by these handlers lack `utoipa::ToSchema`. The chosen approach is the **wrapper type pattern** established by `api_response.rs`:

- Create new response types in `plnd_api/src/api_response.rs` with `#[derive(Serialize, utoipa::ToSchema)]`
- Add `impl From<DbType> for WrapperType` for each
- Update handler return types to use the wrappers

**Why not add ToSchema to plnd_data directly**: Keeps the data layer free of OpenAPI concerns. The API layer owns the contract; plnd_data owns storage.

**JSON compatibility**: Wrapper types mirror source fields exactly — the JSON output is byte-for-byte identical. The Angular frontend is unaffected.

## New Wrapper Types in api_response.rs

| Wrapper | Source | Used by |
|---|---|---|
| `CatalogIngredientResponse` | `CatalogIngredient` | `catalog_details::get_ingredient` |
| `CatalogDishIngredientResponse` | `CatalogDishIngredient` | nested in `DishDetailApiResponse` |
| `CatalogMealDishResponse` | `CatalogMealDish` | nested in `MealDetailApiResponse` |
| `DishDetailApiResponse` | `CatalogDish` fields + ingredients | `catalog_details::get_dish` |
| `MealDetailApiResponse` | `CatalogMeal` fields + dishes | `catalog_details::get_meal` |
| `TaskResponse` | `Task` | `tasks::post_weekly_plan_task` |
| `ScheduleEntryResponse` | `ScheduleEntry` | nested in `SchedulePeriodApiResponse` |
| `SchedulePeriodApiResponse` | `SchedulePeriodResponse` | `schedule::get_period` |
| `PlanStatusApiResponse` | `PlanStatusResponse` | `schedule::get_plan_status` |
| `PostSchedulePlanApiResponse` | `PostSchedulePlanResponse` | `schedule::post_plan` |
| `UserDishPrefDetailResponse` | `UserDishPrefDetail` | `user_dish_prefs` handlers |
| `UserIngredientPrefResponse` | `UserIngredientPref` | `user_ingredient_prefs` handlers |
| `UserMealPrefDetailResponse` | `UserMealPrefDetail` | `user_meal_prefs` handlers |

## Special Annotations Required

- `serde_json::Value` fields → `#[schema(value_type = Object)]` or `Option<Object>`
- `rust_decimal::Decimal` fields → `#[schema(value_type = f64)]`
- `Vec<plnd_data_type>` in search responses → `#[schema(value_type = Vec<Object>)]`
  (avoids needing ToSchema on `LocalIngredientResult`, `LocalDishResult`, etc.)

## DishDetailApiResponse Note

The existing `DishDetailResponse` in `catalog_details.rs` used `#[serde(flatten)]` on `CatalogDish`. utoipa does not handle `flatten` well for schema generation. `DishDetailApiResponse` in `api_response.rs` instead lists all `CatalogDish` fields directly — same JSON shape, schema-compatible.

## Files Changed

- `plnd_api/src/api_response.rs` — 13 new wrapper types
- `plnd_api/src/openapi.rs` — 28 new paths, 26 new schemas, 7 new tags
- `plnd_api/src/routes/catalog_ingest.rs` — 1 handler annotated
- `plnd_api/src/routes/catalog_details.rs` — 3 handlers annotated, local response types removed
- `plnd_api/src/routes/user_ingredient_prefs.rs` — 3 handlers annotated
- `plnd_api/src/routes/user_dish_prefs.rs` — 7 handlers annotated
- `plnd_api/src/routes/user_meal_prefs.rs` — 7 handlers annotated
- `plnd_api/src/routes/search.rs` — 3 handlers annotated
- `plnd_api/src/routes/tasks.rs` — 1 handler annotated
- `plnd_api/src/routes/schedule.rs` — 3 handlers annotated

## Verification

```bash
just verify-build       # utoipa derives are compile-time checked
just test-ci            # regression tests
just test-run-server    # start server, visit /scalar to confirm all routes appear
```
