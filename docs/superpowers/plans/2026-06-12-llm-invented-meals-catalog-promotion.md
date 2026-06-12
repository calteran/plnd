# LLM-invented Meals → Catalog Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the meal-planning agent invent a meal when the catalog has no good fit, then synchronously promote that invention into the shared catalog by searching the external provider endpoints (TheMealDB recipes; USDA FDC / Open Food Facts ingredients) and ingesting the result.

**Architecture:** The agent emits a new `meal_ref` variant `{ "type": "new", … }`. After the agent run, the API layer's promotion service resolves it against providers and ingests into `catalog_meals` → `catalog_dishes` → `catalog_ingredients`, returning a concrete `{ "type": "catalog", "id": … }`. On a provider miss the API re-invokes the agent for that slot, constrained to existing items only. Promotion orchestration lives in `plnd_api`; all SQL lives in `plnd_data` behind `CatalogIngestRepository`; provider detail-fetch lives behind two new `ProviderSearchService` methods.

**Tech Stack:** Rust (Axum, sqlx, async-trait, jsonschema Draft-7, serde), Postgres, Playwright (e2e). Design reference: `docs/superpowers/specs/2026-06-12-llm-invented-meals-catalog-promotion-design.md`.

**Spec decisions (locked):** backend interception · synchronous · shared catalog · miss ⇒ re-invoke constrained · match scope = recipe-first then ingredients · LLM-composed meals tagged `external_source="llm_composed"` + `contributed_by_user_id`, surfaced immediately.

---

## File Structure

**Data layer (`plnd_data`)**
- `plnd_data/src/db/catalog_ingest.rs` — Modify: promote `ingest_meal` to production, add `ingest_dish`, add meal/dish linking helpers.
- `plnd_data/src/repository/catalog_ingest.rs` — Modify: add `ingest_dish` + `ingest_meal` trait methods and their input structs.
- `plnd_data/src/repository/pg/catalog_ingest.rs` — Modify: implement the two new trait methods.
- `plnd_data/src/search/mod.rs` — Modify: add `resolve_dish` + `resolve_ingredient` detail-fetch methods to `ProviderSearchService`.

**Agent layer (`plnd_agent`)**
- `plnd_agent/src/tools/meal.rs` — Modify: widen `meal_ref` in `suggest_slot_meal` + `rebalance_meal_plan` tool schemas to allow the `new` variant.
- `plnd_agent/src/context/mod.rs` — Modify: widen `MealRef` in `SUGGEST_SLOT_RESPONSE_SCHEMA` + `MEAL_PLAN_RESPONSE_SCHEMA`; add `constrained_to_existing` to `AgentContext`.
- `plnd_agent/src/prompts/meal_suggest_slot.md` — Modify: instructions for inventing a meal + honoring the existing-only constraint.
- `plnd_agent/src/prompts/meal_rebalance.md` — Modify: same instructions for the whole-week tool.

**API layer (`plnd_api`)**
- `plnd_api/src/routes/meal_promotion.rs` — Create: `RawMealRef`, `NewMealProposal`, `PromotionOutcome`, and `promote_new_meal(...)`.
- `plnd_api/src/routes/mod.rs` — Modify: declare `mod meal_promotion;`.
- `plnd_api/src/routes/agent.rs` — Modify: parse raw agent output, call promotion, re-invoke constrained on miss, in all three entry points.

**E2E (`plnd_client`)**
- `plnd_client/e2e/meal-plan-invented-meal.spec.ts` — Create: agent mocked to return a `new` ref; assert the wizard renders the promoted meal.

---

## Phase 1 — Data layer: catalog dish + meal ingest

### Task 1: `ingest_dish` free function (dish upsert + ingredient linking)

**Files:**
- Modify: `plnd_data/src/db/catalog_ingest.rs`
- Test: same file, `#[cfg(test)] mod tests`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `plnd_data/src/db/catalog_ingest.rs`:

```rust
    #[sqlx::test(migrations = "./migrations")]
    async fn ingest_dish_links_resolvable_ingredients(pool: PgPool) {
        // Seed one catalog ingredient to link against.
        let ing_id = ingest_ingredient(
            &pool,
            IngestIngredientParams {
                external_source: "usda_fdc",
                external_id: "tomato-1",
                name: "Tomato",
                description: None,
                serving_size_g: Some(Decimal::from(100)),
                nutrition: Some(serde_json::json!({"calories_kcal": 18})),
                allergens: &[],
                occasion_tags: &[],
            },
        )
        .await
        .unwrap();

        let dish_id = ingest_dish(
            &pool,
            IngestDishParams {
                external_source: "themealdb",
                external_id: "recipe-1",
                name: "Tomato Soup",
                description: None,
                instructions: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                nutrition: None,
                contributed_by_user_id: None,
                ingredients: &[DishIngredientLink {
                    ingredient_id: ing_id,
                    quantity: Decimal::from(2),
                    unit: "cup".to_string(),
                    preparation_note: None,
                    is_optional: false,
                    sort_order: 0,
                }],
            },
        )
        .await
        .unwrap();

        // Re-ingest is idempotent: same external key returns the same dish_id.
        let dish_id_again = ingest_dish(
            &pool,
            IngestDishParams {
                external_source: "themealdb",
                external_id: "recipe-1",
                name: "Tomato Soup",
                description: None,
                instructions: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                nutrition: None,
                contributed_by_user_id: None,
                ingredients: &[],
            },
        )
        .await
        .unwrap();
        assert_eq!(dish_id, dish_id_again, "re-ingest must return the same dish_id");

        let link_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM catalog_dish_ingredients WHERE dish_id = $1",
        )
        .bind(dish_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(link_count, 1, "the resolvable ingredient must be linked exactly once");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_data && cargo test --lib db::catalog_ingest::tests::ingest_dish_links_resolvable_ingredients`
Expected: FAIL to **compile** — `ingest_dish`, `IngestDishParams`, `DishIngredientLink` not defined.

- [ ] **Step 3: Write minimal implementation**

Add to `plnd_data/src/db/catalog_ingest.rs` (after `ingest_ingredient`):

```rust
/// A resolved ingredient link for a dish — the ingredient row already exists.
pub struct DishIngredientLink {
    pub ingredient_id: Uuid,
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
    pub sort_order: i16,
}

pub struct IngestDishParams<'a> {
    pub external_source: &'a str,
    pub external_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub instructions: Option<&'a str>,
    pub servings: Decimal,
    pub allergens: &'a [String],
    pub occasion_tags: &'a [String],
    pub nutrition: Option<Value>,
    pub contributed_by_user_id: Option<Uuid>,
    pub ingredients: &'a [DishIngredientLink],
}

#[tracing::instrument(
    skip(pool, params),
    fields(table = "catalog_dishes", op = "ingest_dish")
)]
pub async fn ingest_dish(
    pool: &PgPool,
    params: IngestDishParams<'_>,
) -> Result<Uuid, DatabaseError> {
    let mut tx = pool.begin().await?;

    let tags: Vec<String> = vec![];
    // Upsert the dish on the external key; RETURNING gives the canonical dish_id
    // whether we inserted or matched an existing row.
    let (dish_id,): (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO catalog_dishes
            (name, description, instructions, servings, allergens, allergens_overridden,
             occasion_tags, nutrition, nutrition_overridden, tags,
             external_source, external_id, contributed_by_user_id)
        VALUES ($1, $2, $3, $4, $5, false, $6, $7, false, $8, $9, $10, $11)
        ON CONFLICT ON CONSTRAINT uq_dish_external DO UPDATE SET
            name          = EXCLUDED.name,
            description   = EXCLUDED.description,
            instructions  = EXCLUDED.instructions,
            servings      = EXCLUDED.servings,
            occasion_tags = EXCLUDED.occasion_tags,
            nutrition     = CASE WHEN catalog_dishes.nutrition_overridden
                                 THEN catalog_dishes.nutrition ELSE EXCLUDED.nutrition END,
            updated_at    = now()
        RETURNING dish_id
        "#,
    )
    .bind(params.name)
    .bind(params.description)
    .bind(params.instructions)
    .bind(params.servings)
    .bind(params.allergens)
    .bind(params.occasion_tags)
    .bind(&params.nutrition)
    .bind(&tags)
    .bind(params.external_source)
    .bind(params.external_id)
    .bind(params.contributed_by_user_id)
    .fetch_one(&mut *tx)
    .await?;

    for link in params.ingredients {
        sqlx::query(
            r#"
            INSERT INTO catalog_dish_ingredients
                (dish_id, ingredient_id, quantity, unit, preparation_note, is_optional, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT ON CONSTRAINT uq_dish_ingredient DO UPDATE SET
                quantity         = EXCLUDED.quantity,
                unit             = EXCLUDED.unit,
                preparation_note = EXCLUDED.preparation_note,
                is_optional      = EXCLUDED.is_optional,
                sort_order       = EXCLUDED.sort_order
            "#,
        )
        .bind(dish_id)
        .bind(link.ingredient_id)
        .bind(link.quantity)
        .bind(&link.unit)
        .bind(&link.preparation_note)
        .bind(link.is_optional)
        .bind(link.sort_order)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(dish_id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plnd_data && cargo test --lib db::catalog_ingest::tests::ingest_dish_links_resolvable_ingredients`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_data/src/db/catalog_ingest.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(data): add ingest_dish for catalog dish + ingredient linking"
```

---

### Task 2: Promote `ingest_meal` to production (meal upsert + dish linking)

**Files:**
- Modify: `plnd_data/src/db/catalog_ingest.rs` (remove `#[cfg(test)]`, extend params)
- Test: same file

- [ ] **Step 1: Write the failing test**

Add to the `tests` module:

```rust
    #[sqlx::test(migrations = "./migrations")]
    async fn ingest_meal_links_dishes_and_is_idempotent(pool: PgPool) {
        let dish_id = ingest_dish(
            &pool,
            IngestDishParams {
                external_source: "themealdb",
                external_id: "recipe-2",
                name: "Grilled Cheese",
                description: None,
                instructions: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                nutrition: None,
                contributed_by_user_id: None,
                ingredients: &[],
            },
        )
        .await
        .unwrap();

        let meal_id = ingest_meal(
            &pool,
            IngestMealParams {
                external_source: "themealdb",
                external_id: "recipe-2",
                name: "Grilled Cheese",
                description: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                tags: &[],
                nutrition: Some(serde_json::json!({"calories_kcal": 400})),
                contributed_by_user_id: None,
                dishes: &[MealDishLink { dish_id, dish_servings: Decimal::from(1), sort_order: 0 }],
            },
        )
        .await
        .unwrap();

        let meal_id_again = ingest_meal(
            &pool,
            IngestMealParams {
                external_source: "themealdb",
                external_id: "recipe-2",
                name: "Grilled Cheese",
                description: None,
                servings: Decimal::from(1),
                allergens: &[],
                occasion_tags: &["lunch".to_string()],
                tags: &[],
                nutrition: Some(serde_json::json!({"calories_kcal": 400})),
                contributed_by_user_id: None,
                dishes: &[],
            },
        )
        .await
        .unwrap();
        assert_eq!(meal_id, meal_id_again);

        let link_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM catalog_meal_dishes WHERE meal_id = $1")
                .bind(meal_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(link_count, 1);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_data && cargo test --lib db::catalog_ingest::tests::ingest_meal_links_dishes_and_is_idempotent`
Expected: FAIL to compile — `IngestMealParams` has no `external_source`/`dishes`; `MealDishLink` undefined.

- [ ] **Step 3: Write minimal implementation**

Replace the existing `#[cfg(test)] IngestMealParams` + `#[cfg(test)] ingest_meal` block in `plnd_data/src/db/catalog_ingest.rs` with this production version:

```rust
/// A meal→dish link; the dish row already exists.
pub struct MealDishLink {
    pub dish_id: Uuid,
    pub dish_servings: Decimal,
    pub sort_order: i16,
}

pub struct IngestMealParams<'a> {
    pub external_source: &'a str,
    pub external_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub servings: Decimal,
    pub allergens: &'a [String],
    pub occasion_tags: &'a [String],
    pub tags: &'a [String],
    pub nutrition: Option<Value>,
    pub contributed_by_user_id: Option<Uuid>,
    pub dishes: &'a [MealDishLink],
}

#[tracing::instrument(
    skip(pool, params),
    fields(table = "catalog_meals", op = "ingest_meal")
)]
pub async fn ingest_meal(
    pool: &PgPool,
    params: IngestMealParams<'_>,
) -> Result<Uuid, DatabaseError> {
    let mut tx = pool.begin().await?;

    let (meal_id,): (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO catalog_meals
            (name, description, servings, allergens, allergens_overridden,
             occasion_tags, tags, nutrition, nutrition_overridden,
             external_source, external_id, contributed_by_user_id)
        VALUES ($1, $2, $3, $4, false, $5, $6, $7, false, $8, $9, $10)
        ON CONFLICT ON CONSTRAINT uq_meal_external DO UPDATE SET
            name          = EXCLUDED.name,
            description   = EXCLUDED.description,
            servings      = EXCLUDED.servings,
            occasion_tags = EXCLUDED.occasion_tags,
            tags          = EXCLUDED.tags,
            nutrition     = CASE WHEN catalog_meals.nutrition_overridden
                                 THEN catalog_meals.nutrition ELSE EXCLUDED.nutrition END,
            updated_at    = now()
        RETURNING meal_id
        "#,
    )
    .bind(params.name)
    .bind(params.description)
    .bind(params.servings)
    .bind(params.allergens)
    .bind(params.occasion_tags)
    .bind(params.tags)
    .bind(&params.nutrition)
    .bind(params.external_source)
    .bind(params.external_id)
    .bind(params.contributed_by_user_id)
    .fetch_one(&mut *tx)
    .await?;

    for link in params.dishes {
        sqlx::query(
            r#"
            INSERT INTO catalog_meal_dishes (meal_id, dish_id, dish_servings, sort_order)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT ON CONSTRAINT uq_meal_dish DO UPDATE SET
                dish_servings = EXCLUDED.dish_servings,
                sort_order    = EXCLUDED.sort_order
            "#,
        )
        .bind(meal_id)
        .bind(link.dish_id)
        .bind(link.dish_servings)
        .bind(link.sort_order)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(meal_id)
}
```

Then fix the pre-existing `#[cfg(test)]` tests `ingest_meal_returns_meal_id` and `ingest_meal_stores_nutrition` to pass the new fields (`external_source: "test"`, `external_id: &Uuid::new_v4().to_string()`, `contributed_by_user_id: None`, `dishes: &[]`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd plnd_data && cargo test --lib db::catalog_ingest`
Expected: PASS (all catalog_ingest tests, including the two fixed ones).

- [ ] **Step 5: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_data/src/db/catalog_ingest.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(data): promote ingest_meal to production with dish linking"
```

---

### Task 3: Expose `ingest_dish` + `ingest_meal` on `CatalogIngestRepository`

**Files:**
- Modify: `plnd_data/src/repository/catalog_ingest.rs` (trait + input structs)
- Modify: `plnd_data/src/repository/pg/catalog_ingest.rs` (impl)
- Test: `plnd_data/src/repository/pg/catalog_ingest.rs`

- [ ] **Step 1: Write the failing test**

Add to `plnd_data/src/repository/pg/catalog_ingest.rs` a `#[cfg(test)] mod tests`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::catalog_ingest::{
        DishIngredientLinkInput, IngestDishInput, IngestMealInput, MealDishLinkInput,
    };
    use rust_decimal::Decimal;

    #[sqlx::test(migrations = "./migrations")]
    async fn repo_ingests_meal_through_trait(pool: PgPool) {
        let repo = PgCatalogIngestRepository::new(pool.clone());
        let dish_id = repo
            .ingest_dish(IngestDishInput {
                external_source: "llm_composed".into(),
                external_id: "compose-abc".into(),
                name: "Test Bowl".into(),
                description: None,
                instructions: None,
                servings: Decimal::from(1),
                allergens: vec![],
                occasion_tags: vec!["dinner".into()],
                nutrition: None,
                contributed_by_user_id: None,
                ingredients: vec![],
            })
            .await
            .unwrap();

        let meal_id = repo
            .ingest_meal(IngestMealInput {
                external_source: "llm_composed".into(),
                external_id: "compose-abc".into(),
                name: "Test Bowl".into(),
                description: None,
                servings: Decimal::from(1),
                allergens: vec![],
                occasion_tags: vec!["dinner".into()],
                tags: vec![],
                nutrition: None,
                contributed_by_user_id: None,
                dishes: vec![MealDishLinkInput {
                    dish_id,
                    dish_servings: Decimal::from(1),
                    sort_order: 0,
                }],
            })
            .await
            .unwrap();

        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM catalog_meals WHERE meal_id = $1)")
                .bind(meal_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(exists);
        let _ = DishIngredientLinkInput {
            ingredient_id: uuid::Uuid::nil(),
            quantity: Decimal::from(1),
            unit: "g".into(),
            preparation_note: None,
            is_optional: false,
            sort_order: 0,
        };
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_data && cargo test --lib repository::pg::catalog_ingest::tests::repo_ingests_meal_through_trait`
Expected: FAIL to compile — trait methods + input structs not defined.

- [ ] **Step 3: Write minimal implementation — trait + input structs**

Add to `plnd_data/src/repository/catalog_ingest.rs`:

```rust
pub struct DishIngredientLinkInput {
    pub ingredient_id: Uuid,
    pub quantity: Decimal,
    pub unit: String,
    pub preparation_note: Option<String>,
    pub is_optional: bool,
    pub sort_order: i16,
}

pub struct IngestDishInput {
    pub external_source: String,
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    pub instructions: Option<String>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub nutrition: Option<Value>,
    pub contributed_by_user_id: Option<Uuid>,
    pub ingredients: Vec<DishIngredientLinkInput>,
}

pub struct MealDishLinkInput {
    pub dish_id: Uuid,
    pub dish_servings: Decimal,
    pub sort_order: i16,
}

pub struct IngestMealInput {
    pub external_source: String,
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    pub servings: Decimal,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub tags: Vec<String>,
    pub nutrition: Option<Value>,
    pub contributed_by_user_id: Option<Uuid>,
    pub dishes: Vec<MealDishLinkInput>,
}
```

Then add two methods to the `CatalogIngestRepository` trait:

```rust
    async fn ingest_dish(&self, input: IngestDishInput) -> Result<Uuid, crate::Error>;
    async fn ingest_meal(&self, input: IngestMealInput) -> Result<Uuid, crate::Error>;
```

- [ ] **Step 4: Write minimal implementation — PG impl**

Add to the `impl CatalogIngestRepository for PgCatalogIngestRepository` block in `plnd_data/src/repository/pg/catalog_ingest.rs` (and extend the top `use` of `crate::db::catalog_ingest` and `crate::repository::catalog_ingest` to import the new symbols):

```rust
    async fn ingest_dish(&self, input: IngestDishInput) -> Result<Uuid, crate::Error> {
        let ingredients: Vec<catalog_ingest::DishIngredientLink> = input
            .ingredients
            .into_iter()
            .map(|i| catalog_ingest::DishIngredientLink {
                ingredient_id: i.ingredient_id,
                quantity: i.quantity,
                unit: i.unit,
                preparation_note: i.preparation_note,
                is_optional: i.is_optional,
                sort_order: i.sort_order,
            })
            .collect();
        catalog_ingest::ingest_dish(
            &self.pool,
            catalog_ingest::IngestDishParams {
                external_source: &input.external_source,
                external_id: &input.external_id,
                name: &input.name,
                description: input.description.as_deref(),
                instructions: input.instructions.as_deref(),
                servings: input.servings,
                allergens: &input.allergens,
                occasion_tags: &input.occasion_tags,
                nutrition: input.nutrition,
                contributed_by_user_id: input.contributed_by_user_id,
                ingredients: &ingredients,
            },
        )
        .await
        .map_err(Into::into)
    }

    async fn ingest_meal(&self, input: IngestMealInput) -> Result<Uuid, crate::Error> {
        let dishes: Vec<catalog_ingest::MealDishLink> = input
            .dishes
            .into_iter()
            .map(|d| catalog_ingest::MealDishLink {
                dish_id: d.dish_id,
                dish_servings: d.dish_servings,
                sort_order: d.sort_order,
            })
            .collect();
        catalog_ingest::ingest_meal(
            &self.pool,
            catalog_ingest::IngestMealParams {
                external_source: &input.external_source,
                external_id: &input.external_id,
                name: &input.name,
                description: input.description.as_deref(),
                servings: input.servings,
                allergens: &input.allergens,
                occasion_tags: &input.occasion_tags,
                tags: &input.tags,
                nutrition: input.nutrition,
                contributed_by_user_id: input.contributed_by_user_id,
                dishes: &dishes,
            },
        )
        .await
        .map_err(Into::into)
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd plnd_data && cargo test --lib repository::pg::catalog_ingest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_data/src/repository/catalog_ingest.rs plnd_data/src/repository/pg/catalog_ingest.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(data): expose ingest_dish + ingest_meal on CatalogIngestRepository"
```

---

## Phase 2 — Provider detail-fetch surface

### Task 4: `resolve_dish` + `resolve_ingredient` on `ProviderSearchService`

These return a fully-detailed DTO (with embedded ingredients / nutrition) by searching providers for the best name match, then fetching by id. They keep the private provider vecs encapsulated.

**Files:**
- Modify: `plnd_data/src/search/mod.rs`
- Test: same file (`#[cfg(test)] mod tests`, using a fake provider)

- [ ] **Step 1: Write the failing test**

Add to `plnd_data/src/search/mod.rs` test module (create one if absent). Use a minimal fake `RecipeProvider`:

```rust
#[cfg(test)]
mod resolve_tests {
    use super::*;
    use crate::providers::dtos::{ExternalDish, ExternalDishIngredient, SearchQuery, SearchResult};
    use crate::providers::error::ExternalProviderError;
    use crate::cache::SearchCache;
    use async_trait::async_trait;

    struct FakeRecipe;
    #[async_trait]
    impl RecipeProvider for FakeRecipe {
        fn source_name(&self) -> &str { "themealdb" }
        async fn search_dishes(&self, q: &SearchQuery) -> Result<Vec<SearchResult>, ExternalProviderError> {
            if q.query.to_lowercase().contains("soup") {
                Ok(vec![SearchResult { external_id: "r1".into(), name: "Tomato Soup".into(), ..Default::default() }])
            } else {
                Ok(vec![])
            }
        }
        async fn get_dish_by_id(&self, id: &str) -> Result<Option<ExternalDish>, ExternalProviderError> {
            assert_eq!(id, "r1");
            Ok(Some(ExternalDish {
                external_id: "r1".into(),
                name: "Tomato Soup".into(),
                ingredients: vec![ExternalDishIngredient { name: "Tomato".into(), ..Default::default() }],
                ..Default::default()
            }))
        }
    }

    fn service_with(recipe: Arc<dyn RecipeProvider>) -> ProviderSearchService {
        ProviderSearchService::new(vec![], vec![recipe], vec![], SearchCache::new_default())
    }

    #[tokio::test]
    async fn resolve_dish_returns_detailed_recipe_on_hit() {
        let svc = service_with(Arc::new(FakeRecipe));
        let hit = svc.resolve_dish("tomato soup").await;
        let (source, dish) = hit.expect("expected a recipe hit");
        assert_eq!(source, "themealdb");
        assert_eq!(dish.name, "Tomato Soup");
        assert_eq!(dish.ingredients.len(), 1);
    }

    #[tokio::test]
    async fn resolve_dish_returns_none_on_miss() {
        let svc = service_with(Arc::new(FakeRecipe));
        assert!(svc.resolve_dish("nonexistent meal").await.is_none());
    }
}
```

> If `SearchResult` / `ExternalDish` / `ExternalDishIngredient` do not derive `Default`, either add `#[derive(Default)]` to them in `plnd_data/src/providers/dtos.rs` or construct them with all fields explicitly. Prefer adding `Default` since these are plain data DTOs. Likewise confirm `SearchCache::new_default()` exists; if the constructor differs, use the real one (check `plnd_data/src/cache.rs`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_data && cargo test --lib search::resolve_tests`
Expected: FAIL to compile — `resolve_dish` not defined.

- [ ] **Step 3: Write minimal implementation**

Add to the `impl ProviderSearchService` block in `plnd_data/src/search/mod.rs`. Import the DTOs at top (`use crate::providers::dtos::{ExternalDish, ExternalIngredient};`):

```rust
    /// Resolve a free-text meal/dish name to a fully-detailed recipe by searching
    /// the recipe providers in order and fetching the top match by id. Returns
    /// `(source_name, dish)` on the first confident hit, or `None` on a miss /
    /// provider error (errors are swallowed — a miss, not a failure).
    pub async fn resolve_dish(&self, name: &str) -> Option<(String, ExternalDish)> {
        let query = SearchQuery { query: name.to_string(), limit: 1, exclude_allergens: vec![] };
        for provider in &self.recipe_providers {
            let Ok(results) = provider.search_dishes(&query).await else { continue };
            let Some(top) = results.into_iter().next() else { continue };
            match provider.get_dish_by_id(&top.external_id).await {
                Ok(Some(dish)) => return Some((provider.source_name().to_string(), dish)),
                _ => continue,
            }
        }
        None
    }

    /// Resolve a free-text ingredient name to a detailed ingredient (with nutrition)
    /// by searching the nutrition providers in order and fetching the top match by id.
    pub async fn resolve_ingredient(&self, name: &str) -> Option<(String, ExternalIngredient)> {
        let query = SearchQuery { query: name.to_string(), limit: 1, exclude_allergens: vec![] };
        for provider in &self.nutrition_providers {
            let Ok(results) = provider.search_ingredients(&query).await else { continue };
            let Some(top) = results.into_iter().next() else { continue };
            match provider.get_ingredient_by_id(&top.external_id).await {
                Ok(Some(ing)) => return Some((provider.source_name().to_string(), ing)),
                _ => continue,
            }
        }
        None
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plnd_data && cargo test --lib search::resolve_tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_data/src/search/mod.rs plnd_data/src/providers/dtos.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(data): add resolve_dish + resolve_ingredient detail-fetch to ProviderSearchService"
```

---

## Phase 3 — Agent surface: allow the `new` meal_ref variant

### Task 5: Widen terminal tool schemas in `meal.rs`

The `suggest_slot_meal` and `rebalance_meal_plan` tool schemas currently require `meal_ref = {type ∈ [catalog,user], id}`. Allow a third shape.

**Files:**
- Modify: `plnd_agent/src/tools/meal.rs` (the two `schema()` methods + a shared helper)
- Test: `plnd_agent/src/tools/meal.rs` tests module

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `plnd_agent/src/tools/meal.rs`:

```rust
    #[test]
    fn suggest_slot_meal_ref_allows_new_variant() {
        let schema = SuggestSlotMealTool.schema();
        let meal_ref = &schema["properties"]["meal_ref"];
        // The widened schema is a oneOf of {existing ref} | {new proposal}.
        let variants = meal_ref["oneOf"].as_array().expect("meal_ref must be a oneOf");
        assert_eq!(variants.len(), 2, "expected existing + new variants");
        let has_new = variants.iter().any(|v| {
            v["properties"]["type"]["const"] == "new"
                || v["properties"]["type"]["enum"].as_array().is_some_and(|e| e.iter().any(|x| x == "new"))
        });
        assert!(has_new, "one variant must accept type=new");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_agent && cargo test --lib tools::meal::tests::suggest_slot_meal_ref_allows_new_variant`
Expected: FAIL — `meal_ref` is a flat object, no `oneOf`.

- [ ] **Step 3: Write minimal implementation**

Add a shared helper near the schema constructors in `plnd_agent/src/tools/meal.rs`:

```rust
/// The `meal_ref` shape used by the slot/rebalance terminal tools. Either an
/// existing reference (`catalog`/`user` + UUID) or a `new` proposal the API
/// layer promotes into the catalog after the run.
fn meal_ref_schema() -> serde_json::Value {
    serde_json::json!({
        "oneOf": [
            {
                "type": "object",
                "required": ["type", "id"],
                "additionalProperties": false,
                "properties": {
                    "type": { "type": "string", "enum": ["catalog", "user"] },
                    "id":   { "type": "string", "format": "uuid" }
                }
            },
            {
                "type": "object",
                "required": ["type", "name", "inferred_ingredients", "estimated_nutrition"],
                "additionalProperties": false,
                "properties": {
                    "type": { "type": "string", "const": "new" },
                    "name": { "type": "string", "description": "Display name of the meal you are inventing." },
                    "occasion_tags": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Occasions this meal fits (e.g. 'breakfast', 'dinner')."
                    },
                    "inferred_ingredients": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "required": ["name", "grams"],
                            "additionalProperties": false,
                            "properties": {
                                "name":  { "type": "string" },
                                "grams": { "type": "number", "exclusiveMinimum": 0 }
                            }
                        },
                        "description": "Ingredients you believe make up this meal, for catalog lookup."
                    },
                    "estimated_nutrition": {
                        "type": "object",
                        "required": ["kcal", "protein_g", "carbs_g", "fat_g"],
                        "additionalProperties": false,
                        "properties": {
                            "kcal":      { "type": "number" },
                            "protein_g": { "type": "number" },
                            "carbs_g":   { "type": "number" },
                            "fat_g":     { "type": "number" }
                        }
                    }
                }
            }
        ]
    })
}
```

Then in both `SuggestSlotMealTool::schema()` and `RebalanceMealPlanTool::schema()`, replace the inline `"meal_ref": { "type": "object", … }` block with `"meal_ref": meal_ref_schema()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd plnd_agent && cargo test --lib tools::meal`
Expected: PASS (new test + existing meal tests).

- [ ] **Step 5: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_agent/src/tools/meal.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(agent): allow new meal_ref variant in slot + rebalance tool schemas"
```

---

### Task 6: Widen response-schema validators in `context/mod.rs`

The post-run validators (`SUGGEST_SLOT_RESPONSE_SCHEMA`, `MEAL_PLAN_RESPONSE_SCHEMA`) must accept the same `new` shape or every invented-meal run fails validation in `AgentService::run`.

**Files:**
- Modify: `plnd_agent/src/context/mod.rs`
- Test: `plnd_agent/src/context/mod.rs` tests module

- [ ] **Step 1: Write the failing test**

Add (find or create the `#[cfg(test)] mod tests` in `context/mod.rs`):

```rust
    #[test]
    fn suggest_slot_validator_accepts_new_meal_ref() {
        let payload = serde_json::json!({
            "date": "2026-06-15",
            "meal_name": "dinner",
            "meal_ref": {
                "type": "new",
                "name": "Spicy Peanut Tofu Bowl",
                "occasion_tags": ["dinner"],
                "inferred_ingredients": [{ "name": "tofu", "grams": 150.0 }],
                "estimated_nutrition": { "kcal": 520.0, "protein_g": 28.0, "carbs_g": 40.0, "fat_g": 22.0 }
            }
        });
        assert!(suggest_slot_validator().is_valid(&payload));
    }

    #[test]
    fn suggest_slot_validator_still_accepts_catalog_ref() {
        let payload = serde_json::json!({
            "date": "2026-06-15",
            "meal_name": "dinner",
            "meal_ref": { "type": "catalog", "id": "00000000-0000-0000-0000-000000000001" }
        });
        assert!(suggest_slot_validator().is_valid(&payload));
    }
```

> `suggest_slot_validator()` is the existing accessor returning the `LazyLock<Validator>` (confirm its exact name in the file — it may be `suggest_slot_validator()` or a `static`. Use whatever the file already exposes; if it's a private static, reference it directly, e.g. `SUGGEST_SLOT_VALIDATOR.is_valid(&payload)`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_agent && cargo test --lib context::tests::suggest_slot_validator_accepts_new_meal_ref`
Expected: FAIL — current `MealRef` requires `id` and `enum:[catalog,user]`.

- [ ] **Step 3: Write minimal implementation**

In `plnd_agent/src/context/mod.rs`, replace the `"MealRef"` definition inside **both** `SUGGEST_SLOT_RESPONSE_SCHEMA` and `MEAL_PLAN_RESPONSE_SCHEMA` with this `oneOf` form (keep the `definitions` wrapper; only the `MealRef` value changes):

```json
    "MealRef": {
      "oneOf": [
        {
          "type": "object",
          "required": ["type", "id"],
          "additionalProperties": false,
          "properties": {
            "type": { "type": "string", "enum": ["catalog", "user"] },
            "id":   { "type": "string", "format": "uuid" }
          }
        },
        {
          "type": "object",
          "required": ["type", "name", "inferred_ingredients", "estimated_nutrition"],
          "additionalProperties": false,
          "properties": {
            "type":  { "type": "string", "const": "new" },
            "name":  { "type": "string" },
            "occasion_tags": { "type": "array", "items": { "type": "string" } },
            "inferred_ingredients": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "required": ["name", "grams"],
                "additionalProperties": false,
                "properties": {
                  "name":  { "type": "string" },
                  "grams": { "type": "number", "exclusiveMinimum": 0 }
                }
              }
            },
            "estimated_nutrition": { "$ref": "#/definitions/Nutrition" }
          }
        }
      ]
    }
```

> Leave `RESOLVE_RESPONSE_SCHEMA` (the adhoc path) unchanged — out of scope per the spec.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd plnd_agent && cargo test --lib context`
Expected: PASS (new tests + existing context tests).

- [ ] **Step 5: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_agent/src/context/mod.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(agent): accept new meal_ref variant in slot + rebalance response validators"
```

---

### Task 7: Add `constrained_to_existing` context flag + prompt updates

The re-invocation on a provider miss must tell the agent to pick **only** existing items.

**Files:**
- Modify: `plnd_agent/src/context/mod.rs` (`AgentContext` field)
- Modify: `plnd_agent/src/prompts/meal_suggest_slot.md`
- Modify: `plnd_agent/src/prompts/meal_rebalance.md`
- Test: `plnd_agent/src/context/mod.rs`

- [ ] **Step 1: Write the failing test**

Add to `context/mod.rs` tests:

```rust
    #[test]
    fn agent_context_defaults_to_unconstrained() {
        let ctx = AgentContext {
            user_id: uuid::Uuid::nil(),
            use_case: UseCase::MealSuggestSlot,
            ..AgentContext::minimal_for_test()
        };
        assert!(!ctx.constrained_to_existing);
    }
```

> If `AgentContext` has no test constructor, instead assert the field exists by constructing the struct fully in the test with `constrained_to_existing: false` and reading it back. Match the struct's real construction pattern used elsewhere in this file's tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_agent && cargo test --lib context::tests::agent_context_defaults_to_unconstrained`
Expected: FAIL — no `constrained_to_existing` field.

- [ ] **Step 3: Write minimal implementation**

Add to the `AgentContext` struct in `plnd_agent/src/context/mod.rs`:

```rust
    /// When true (set on a provider-miss re-invocation), the agent MUST choose an
    /// existing catalog/user meal and MUST NOT emit a `new` meal_ref.
    pub constrained_to_existing: bool,
```

Initialise it to `false` at every existing `AgentContext { … }` construction site in `plnd_api/src/routes/agent.rs` (the executor will hit compile errors pointing at each — set `constrained_to_existing: false` there). The constrained re-invocation in Task 10 sets it to `true`.

Then, in the system-prompt assembly (find where `use_case.prompt()` / context is rendered into the system prompt — search `constrained` is absent; locate the function that builds the prompt string for meal use-cases), append a directive when the flag is set. The simplest seam: in the function that renders the meal context block, add:

```rust
    if ctx.constrained_to_existing {
        prompt.push_str(
            "\n\nIMPORTANT CONSTRAINT: A previous attempt to source a novel meal failed. \
             For this request you MUST select an existing meal from the catalog or the user's \
             library (meal_ref type 'catalog' or 'user'). Do NOT invent a meal; do NOT emit a \
             meal_ref with type 'new'.",
        );
    }
```

> Locate the exact prompt-assembly function by searching for where `MEAL_SUGGEST_SLOT_PROMPT` is concatenated with dynamic context. Add the directive there so it applies to both slot and rebalance flows.

- [ ] **Step 4: Update the static prompt files**

In `plnd_agent/src/prompts/meal_suggest_slot.md`, add a section (the executor places it near the existing "choose a meal" guidance):

```markdown
## Inventing a meal

Prefer an existing catalog or user-library match. If — and only if — nothing in
the catalog or the user's library is a good fit for this slot, you may invent a
meal by returning a `meal_ref` of `type: "new"` with:

- `name`: the meal's display name
- `occasion_tags`: occasions it fits (e.g. `["dinner"]`)
- `inferred_ingredients`: the ingredients you believe compose it, each with an
  estimated portion in `grams`
- `estimated_nutrition`: your best estimate of the per-serving macros

The system will look up your invented meal against real recipe and nutrition
data and add it to the shared catalog. Do not invent a meal when a reasonable
existing option is available.
```

Add the equivalent section to `plnd_agent/src/prompts/meal_rebalance.md`, phrased for filling open slots in the week envelope.

- [ ] **Step 5: Run tests + build to verify**

Run: `cd plnd_agent && cargo test --lib context`
Expected: PASS.
Run: `just verify-build`
Expected: compiles (this surfaces the `AgentContext` construction sites in `plnd_api` that need `constrained_to_existing: false`; fix each).

- [ ] **Step 6: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_agent/src/context/mod.rs plnd_agent/src/prompts/meal_suggest_slot.md plnd_agent/src/prompts/meal_rebalance.md plnd_api/src/routes/agent.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(agent): add constrained_to_existing flag + invent-a-meal prompt guidance"
```

---

## Phase 4 — Promotion service (`plnd_api`)

### Task 8: `meal_promotion.rs` — raw parse types + `promote_new_meal`

**Files:**
- Create: `plnd_api/src/routes/meal_promotion.rs`
- Modify: `plnd_api/src/routes/mod.rs` (`mod meal_promotion;`)
- Test: `plnd_api/src/routes/meal_promotion.rs` tests module

This module owns: (a) the raw deserialization of the agent's `meal_ref` (which may be `new`), and (b) the resolve→ingest orchestration.

- [ ] **Step 1: Write the failing test**

Create `plnd_api/src/routes/meal_promotion.rs` starting with tests that pin the parse + the composition (ingredient-branch) using fakes:

```rust
//! Promotion of LLM-invented meals into the shared catalog.
//!
//! After an agent run, a `meal_ref` may be `{ "type": "new", … }`. This module
//! resolves that proposal against the provider detail-fetch surface and ingests
//! it into `catalog_meals` → `catalog_dishes` → `catalog_ingredients`, returning
//! a concrete catalog meal_ref. On a provider miss it returns `Missed` so the
//! caller can re-invoke the agent constrained to existing items.

use std::sync::Arc;

use serde::Deserialize;
use uuid::Uuid;

use plnd_data::repository::CatalogIngestRepository;
use plnd_data::search::ProviderSearchService;

#[derive(Debug, Clone, Deserialize)]
pub struct InferredIngredient {
    pub name: String,
    pub grams: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewMealProposal {
    pub name: String,
    #[serde(default)]
    pub occasion_tags: Vec<String>,
    pub inferred_ingredients: Vec<InferredIngredient>,
    // estimated_nutrition is carried on the MealEntry, not needed for ingest keying.
}

/// Raw `meal_ref` straight off the agent — either an existing ref or a `new` proposal.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RawMealRef {
    Catalog { id: Uuid },
    User { id: Uuid },
    New(NewMealProposal),
}

#[derive(Debug, PartialEq)]
pub enum PromotionOutcome {
    /// Existing ref passed through, or a `new` proposal successfully promoted.
    Resolved { meal_type: String, id: Uuid },
    /// Providers had nothing — caller should re-invoke constrained to existing.
    Missed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_meal_ref_parses_catalog() {
        let v = serde_json::json!({ "type": "catalog", "id": "00000000-0000-0000-0000-000000000001" });
        let r: RawMealRef = serde_json::from_value(v).unwrap();
        assert!(matches!(r, RawMealRef::Catalog { .. }));
    }

    #[test]
    fn raw_meal_ref_parses_new() {
        let v = serde_json::json!({
            "type": "new",
            "name": "Spicy Peanut Tofu Bowl",
            "occasion_tags": ["dinner"],
            "inferred_ingredients": [{ "name": "tofu", "grams": 150.0 }]
        });
        let r: RawMealRef = serde_json::from_value(v).unwrap();
        match r {
            RawMealRef::New(p) => {
                assert_eq!(p.name, "Spicy Peanut Tofu Bowl");
                assert_eq!(p.inferred_ingredients.len(), 1);
            }
            _ => panic!("expected New"),
        }
    }
}
```

- [ ] **Step 2: Register the module + run tests to verify they fail/compile**

Add `mod meal_promotion;` to `plnd_api/src/routes/mod.rs`.
Run: `cd plnd_api && cargo test --lib routes::meal_promotion`
Expected: PASS for the two parse tests (they only need the types). If they don't compile, fix imports. This task establishes the types; the orchestration test comes in Task 9.

- [ ] **Step 3: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_api/src/routes/meal_promotion.rs plnd_api/src/routes/mod.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(api): add meal_promotion raw parse types"
```

---

### Task 9: `promote_new_meal` orchestration (recipe-first, then ingredients)

**Files:**
- Modify: `plnd_api/src/routes/meal_promotion.rs`
- Test: same file

- [ ] **Step 1: Write the failing test**

Add to `meal_promotion.rs` tests an in-memory `CatalogIngestRepository` fake and a `ProviderSearchService` built with fakes that miss, to assert the miss path; and one with an ingredient provider that hits, to assert composition. (Recipe-hit is covered by the e2e fixture path; unit-test the miss + ingredient-compose branches which carry the real logic.)

```rust
    use plnd_data::repository::catalog_ingest::{
        ContributeIngredientInput, IngestDishInput, IngestIngredientInput, IngestMealInput,
    };
    use std::sync::Mutex;

    #[derive(Default)]
    struct CountingIngestRepo {
        ingredients: Mutex<u32>,
        dishes: Mutex<u32>,
        meals: Mutex<u32>,
    }
    #[async_trait::async_trait]
    impl CatalogIngestRepository for CountingIngestRepo {
        async fn ingest_ingredient(&self, _i: IngestIngredientInput) -> Result<Uuid, plnd_data::Error> {
            *self.ingredients.lock().unwrap() += 1;
            Ok(Uuid::new_v4())
        }
        async fn contribute_ingredient(&self, _i: ContributeIngredientInput) -> Result<Uuid, plnd_data::Error> {
            Ok(Uuid::new_v4())
        }
        async fn ingest_dish(&self, _i: IngestDishInput) -> Result<Uuid, plnd_data::Error> {
            *self.dishes.lock().unwrap() += 1;
            Ok(Uuid::new_v4())
        }
        async fn ingest_meal(&self, _i: IngestMealInput) -> Result<Uuid, plnd_data::Error> {
            *self.meals.lock().unwrap() += 1;
            Ok(Uuid::new_v4())
        }
    }

    fn empty_search_service() -> ProviderSearchService {
        // No providers → every resolve_* returns None → guaranteed miss.
        ProviderSearchService::new(vec![], vec![], vec![], plnd_data::cache::SearchCache::new_default())
    }

    #[tokio::test]
    async fn promote_returns_missed_when_no_provider_resolves() {
        let repo: Arc<dyn CatalogIngestRepository> = Arc::new(CountingIngestRepo::default());
        let svc = empty_search_service();
        let proposal = NewMealProposal {
            name: "Imaginary Stew".into(),
            occasion_tags: vec!["dinner".into()],
            inferred_ingredients: vec![InferredIngredient { name: "moonbeams".into(), grams: 100.0 }],
        };
        let out = promote_new_meal(&svc, repo.as_ref(), Uuid::new_v4(), &proposal).await;
        assert_eq!(out, PromotionOutcome::Missed);
    }
```

> If `SearchCache::new_default` / `plnd_data::cache` visibility differs, expose a test constructor or reuse the same builder the real `AppState` uses. Keep providers empty to force the miss deterministically.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_api && cargo test --lib routes::meal_promotion::tests::promote_returns_missed_when_no_provider_resolves`
Expected: FAIL to compile — `promote_new_meal` undefined.

- [ ] **Step 3: Write minimal implementation**

Add to `plnd_api/src/routes/meal_promotion.rs`:

```rust
use plnd_data::repository::catalog_ingest::{
    DishIngredientLinkInput, IngestDishInput, IngestIngredientInput, IngestMealInput,
    MealDishLinkInput,
};
use rust_decimal::Decimal;

/// Deterministic external_id for an LLM-composed (non-recipe) meal so concurrent
/// or repeat promotions of the same invented name dedup via ON CONFLICT.
fn llm_composed_external_id(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    format!("llm-{}", slug.trim_matches('-'))
}

/// Promote a `new` meal proposal into the shared catalog.
///
/// Strategy (spec: "both — recipe then ingredients"):
/// 1. Search recipe providers (TheMealDB) by name; on a hit, ingest the recipe
///    as a catalog dish (resolvable ingredients linked) wrapped in a catalog meal.
/// 2. Otherwise resolve the LLM's inferred ingredients against the nutrition
///    providers; if ≥1 resolves, compose one dish + meal from them.
/// 3. If neither yields anything, return `Missed`.
pub async fn promote_new_meal(
    search: &ProviderSearchService,
    ingest: &dyn CatalogIngestRepository,
    user_id: Uuid,
    proposal: &NewMealProposal,
) -> PromotionOutcome {
    // ── Branch 1: recipe match ────────────────────────────────────────────────
    if let Some((source, dish)) = search.resolve_dish(&proposal.name).await {
        // Resolve & ingest each recipe ingredient we can; link only those (mirror seeder).
        let mut links: Vec<DishIngredientLinkInput> = Vec::new();
        for (idx, di) in dish.ingredients.iter().enumerate() {
            if let Some((ing_source, ing)) = search.resolve_ingredient(&di.name).await {
                if let Ok(ingredient_id) = ingest
                    .ingest_ingredient(ingredient_input_from(&ing_source, &ing))
                    .await
                {
                    links.push(DishIngredientLinkInput {
                        ingredient_id,
                        quantity: Decimal::from(1),
                        unit: "serving".into(),
                        preparation_note: None,
                        is_optional: false,
                        sort_order: idx as i16,
                    });
                }
            }
        }
        let Ok(dish_id) = ingest
            .ingest_dish(IngestDishInput {
                external_source: source.clone(),
                external_id: dish.external_id.clone(),
                name: dish.name.clone(),
                description: None,
                instructions: None,
                servings: Decimal::from(1),
                allergens: vec![],
                occasion_tags: proposal.occasion_tags.clone(),
                nutrition: None,
                contributed_by_user_id: None,
                ingredients: links,
            })
            .await
        else {
            return PromotionOutcome::Missed;
        };
        return wrap_dish_in_meal(ingest, source, dish.external_id, dish.name, proposal, dish_id, None).await;
    }

    // ── Branch 2: compose from inferred ingredients ──────────────────────────
    let mut links: Vec<DishIngredientLinkInput> = Vec::new();
    for (idx, inferred) in proposal.inferred_ingredients.iter().enumerate() {
        if let Some((ing_source, ing)) = search.resolve_ingredient(&inferred.name).await {
            if let Ok(ingredient_id) = ingest
                .ingest_ingredient(ingredient_input_from(&ing_source, &ing))
                .await
            {
                links.push(DishIngredientLinkInput {
                    ingredient_id,
                    quantity: Decimal::try_from(inferred.grams).unwrap_or(Decimal::from(1)),
                    unit: "g".into(),
                    preparation_note: None,
                    is_optional: false,
                    sort_order: idx as i16,
                });
            }
        }
    }

    if links.is_empty() {
        // Zero ingredients resolved → provider miss.
        return PromotionOutcome::Missed;
    }

    let ext_id = llm_composed_external_id(&proposal.name);
    let Ok(dish_id) = ingest
        .ingest_dish(IngestDishInput {
            external_source: "llm_composed".into(),
            external_id: ext_id.clone(),
            name: proposal.name.clone(),
            description: None,
            instructions: None,
            servings: Decimal::from(1),
            allergens: vec![],
            occasion_tags: proposal.occasion_tags.clone(),
            nutrition: None,
            contributed_by_user_id: Some(user_id),
            ingredients: links,
        })
        .await
    else {
        return PromotionOutcome::Missed;
    };

    wrap_dish_in_meal(
        ingest,
        "llm_composed".into(),
        ext_id,
        proposal.name.clone(),
        proposal,
        dish_id,
        Some(user_id),
    )
    .await
}

fn ingredient_input_from(
    source: &str,
    ing: &plnd_data::providers::dtos::ExternalIngredient,
) -> IngestIngredientInput {
    IngestIngredientInput {
        external_source: source.to_string(),
        external_id: ing.external_id.clone(),
        name: ing.name.clone(),
        description: None,
        serving_size_g: None,
        nutrition: ing
            .nutrition
            .as_ref()
            .and_then(|n| serde_json::to_value(n).ok()),
        allergens: vec![],
        occasion_tags: vec![],
    }
}

#[allow(clippy::too_many_arguments)]
async fn wrap_dish_in_meal(
    ingest: &dyn CatalogIngestRepository,
    external_source: String,
    external_id: String,
    name: String,
    proposal: &NewMealProposal,
    dish_id: Uuid,
    contributed_by_user_id: Option<Uuid>,
) -> PromotionOutcome {
    match ingest
        .ingest_meal(IngestMealInput {
            external_source,
            external_id,
            name,
            description: None,
            servings: Decimal::from(1),
            allergens: vec![],
            occasion_tags: proposal.occasion_tags.clone(),
            tags: vec![],
            nutrition: None,
            contributed_by_user_id,
            dishes: vec![MealDishLinkInput {
                dish_id,
                dish_servings: Decimal::from(1),
                sort_order: 0,
            }],
        })
        .await
    {
        Ok(meal_id) => PromotionOutcome::Resolved {
            meal_type: "catalog".into(),
            id: meal_id,
        },
        Err(_) => PromotionOutcome::Missed,
    }
}
```

> Confirm `ExternalIngredient.nutrition` is `Option<NutritionFacts>` and that `NutritionFacts: Serialize` (it is — used by the seeder). Adjust the `serde_json::to_value` mapping if the field name differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plnd_api && cargo test --lib routes::meal_promotion`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_api/src/routes/meal_promotion.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(api): promote_new_meal — recipe-first then ingredient composition"
```

---

## Phase 5 — Orchestration wiring (`plnd_api/src/routes/agent.rs`)

### Task 10: Intercept `new` refs + re-invoke constrained on miss (single suggest-slot)

Start with the single-slot route (`post_meal_plan_suggest_slot`, around `agent.rs:1080-1145`) — the smallest surface — then reuse the helper for the fan-out and rebalance.

**Files:**
- Modify: `plnd_api/src/routes/agent.rs`
- Test: `plnd_api/src/routes/agent.rs` tests module (helper-level unit test)

- [ ] **Step 1: Write the failing test**

Add a unit test for a small helper that decides resolution from a parsed `RawMealRef` + a promotion outcome. This keeps the HTTP path thin and testable:

```rust
    #[tokio::test]
    async fn resolve_or_passthrough_passes_existing_refs_unchanged() {
        // An existing catalog ref must pass straight through without promotion.
        let raw = crate::routes::meal_promotion::RawMealRef::Catalog {
            id: uuid::Uuid::from_u128(1),
        };
        let outcome = super::existing_ref_outcome(&raw);
        assert_eq!(
            outcome,
            Some(crate::routes::meal_promotion::PromotionOutcome::Resolved {
                meal_type: "catalog".into(),
                id: uuid::Uuid::from_u128(1),
            })
        );
    }

    #[tokio::test]
    async fn resolve_or_passthrough_returns_none_for_new() {
        let raw = crate::routes::meal_promotion::RawMealRef::New(
            crate::routes::meal_promotion::NewMealProposal {
                name: "X".into(),
                occasion_tags: vec![],
                inferred_ingredients: vec![],
            },
        );
        assert_eq!(super::existing_ref_outcome(&raw), None);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_api && cargo test --lib routes::agent::tests::resolve_or_passthrough_passes_existing_refs_unchanged`
Expected: FAIL — `existing_ref_outcome` undefined.

- [ ] **Step 3: Write the helper + wire the single-slot route**

Add to `plnd_api/src/routes/agent.rs`:

```rust
use crate::routes::meal_promotion::{promote_new_meal, PromotionOutcome, RawMealRef};

/// Existing refs need no provider work — map them straight to a Resolved outcome.
/// Returns None for a `new` proposal (which must go through `promote_new_meal`).
fn existing_ref_outcome(raw: &RawMealRef) -> Option<PromotionOutcome> {
    match raw {
        RawMealRef::Catalog { id } => Some(PromotionOutcome::Resolved {
            meal_type: "catalog".into(),
            id: *id,
        }),
        RawMealRef::User { id } => Some(PromotionOutcome::Resolved {
            meal_type: "user".into(),
            id: *id,
        }),
        RawMealRef::New(_) => None,
    }
}
```

Then add an async helper that resolves one agent output for a slot, promoting or re-invoking:

```rust
/// Resolve one slot's agent output into a concrete MealEntry, promoting a `new`
/// meal_ref through providers and re-invoking the agent constrained-to-existing
/// on a provider miss. `build_ctx` produces a fresh constrained context.
async fn resolve_slot_meal(
    state: &AppState,
    user_id: Uuid,
    slot_date: chrono::NaiveDate,
    slot_name: &str,
    raw_value: &serde_json::Value,
    build_constrained_ctx: impl Fn() -> AgentContext,
) -> Result<MealEntry, FailedSlot> {
    // Parse the meal_ref out of the raw agent output.
    let raw_ref: RawMealRef = serde_json::from_value(raw_value["meal_ref"].clone())
        .map_err(|e| FailedSlot { date: slot_date, meal_name: slot_name.to_string(), reason: format!("bad meal_ref: {e}") })?;

    let outcome = match existing_ref_outcome(&raw_ref) {
        Some(o) => o,
        None => {
            let RawMealRef::New(proposal) = &raw_ref else { unreachable!() };
            match promote_new_meal(&state.provider_search, state.repos.catalog_ingest.as_ref(), user_id, proposal).await {
                PromotionOutcome::Resolved { meal_type, id } => PromotionOutcome::Resolved { meal_type, id },
                PromotionOutcome::Missed => {
                    // Re-invoke constrained to existing items, one attempt.
                    let ctx = build_constrained_ctx();
                    let out = state.agent.run(&ctx).await.map_err(|e| FailedSlot {
                        date: slot_date, meal_name: slot_name.to_string(), reason: e.to_string(),
                    })?;
                    let v: serde_json::Value = serde_json::from_str(&out.content).map_err(|e| FailedSlot {
                        date: slot_date, meal_name: slot_name.to_string(), reason: e.to_string(),
                    })?;
                    let reref: RawMealRef = serde_json::from_value(v["meal_ref"].clone()).map_err(|e| FailedSlot {
                        date: slot_date, meal_name: slot_name.to_string(), reason: format!("constrained retry bad meal_ref: {e}"),
                    })?;
                    existing_ref_outcome(&reref).ok_or_else(|| FailedSlot {
                        date: slot_date, meal_name: slot_name.to_string(),
                        reason: "constrained retry still returned a new meal".into(),
                    })?
                }
            }
        }
    };

    let PromotionOutcome::Resolved { meal_type, id } = outcome else {
        return Err(FailedSlot { date: slot_date, meal_name: slot_name.to_string(), reason: "unresolved".into() });
    };

    // Reuse the original nutrition estimate if present.
    let estimated_nutrition = serde_json::from_value(raw_value["estimated_nutrition"].clone()).ok();
    Ok(stamp_slot_identity(
        MealEntry {
            date: slot_date,
            meal_name: slot_name.to_string(),
            meal_ref: crate::models::MealRef { meal_type, id },
            title: None,
            estimated_nutrition,
        },
        slot_date,
        slot_name,
    ))
}
```

Wire the single-slot route (`post_meal_plan_suggest_slot`) to: run the agent → parse output into a `serde_json::Value` → call `resolve_slot_meal` with a `build_constrained_ctx` closure that calls `build_suggest_slot_ctx(...)` and sets `constrained_to_existing: true`.

> `build_suggest_slot_ctx` currently returns a context with `constrained_to_existing: false`. Add a variant or set the field after building: `let mut ctx = build_suggest_slot_ctx(...); ctx.constrained_to_existing = true; ctx`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd plnd_api && cargo test --lib routes::agent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_api/src/routes/agent.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(api): promote new meal_refs + constrained re-invoke in suggest-slot route"
```

---

### Task 11: Wire promotion into the parallel fan-out (`post_meal_plan`)

**Files:**
- Modify: `plnd_api/src/routes/agent.rs` (the `fill_slots_parallel` closure, ~lines 705-768)

- [ ] **Step 1: Adjust the fan-out closure**

In `post_meal_plan`, the closure currently parses `output.content` directly into `MealEntry`. Change it to parse into `serde_json::Value`, then call `resolve_slot_meal` (Task 10) with a constrained-context builder for that slot:

```rust
        async move {
            let ctx = build_suggest_slot_ctx(user_id, &slot, &prefs, &locked, &[]);
            match agent.run(&ctx).await {
                Ok(output) => {
                    let rate_limited = output.rate_limited;
                    let result = match serde_json::from_str::<serde_json::Value>(&output.content) {
                        Ok(value) => {
                            let slot2 = slot.clone();
                            let prefs2 = Arc::clone(&prefs);
                            let locked2 = Arc::clone(&locked);
                            resolve_slot_meal(
                                &state_for_closure,
                                user_id,
                                slot.date,
                                &slot.meal_name,
                                &value,
                                || {
                                    let mut c = build_suggest_slot_ctx(user_id, &slot2, &prefs2, &locked2, &[]);
                                    c.constrained_to_existing = true;
                                    c
                                },
                            )
                            .await
                        }
                        Err(e) => Err(FailedSlot { date: slot.date, meal_name: slot.meal_name.clone(), reason: e.to_string() }),
                    };
                    SlotOutcome { result, rate_limited }
                }
                Err(e) => { /* unchanged error arm */ }
            }
        }
```

> `resolve_slot_meal` needs `&AppState`; pass an `Arc<AppState>`/clone (`state_for_closure`) captured into the fan-out, mirroring how `agent`/`locked`/`prefs` are cloned at lines 700-708. Confirm `AppState` derives `Clone` (it does) so a per-slot clone is cheap (all fields are `Arc`/cheap handles).

- [ ] **Step 2: Build + run**

Run: `just verify-build`
Expected: compiles.
Run: `cd plnd_api && cargo test --lib routes::agent`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_api/src/routes/agent.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(api): promote invented meals in the meal-plan fan-out"
```

---

### Task 12: Wire promotion into rebalance (`post_meal_plan_rebalance`)

**Files:**
- Modify: `plnd_api/src/routes/agent.rs` (~lines 1009-1075)

- [ ] **Step 1: Adjust the rebalance handler**

After the rebalance agent returns the week envelope, iterate `meals[]`; for each entry whose `meal_ref.type == "new"`, run `promote_new_meal`; on `Missed`, re-invoke a constrained `MealSuggestSlot` for that one slot (reuse `resolve_slot_meal` per entry by parsing each entry's JSON object). Replace the entry's `meal_ref` with the resolved one. Entries with existing refs pass through unchanged.

```rust
    // After parsing the rebalance output into a serde_json::Value `plan`:
    let mut resolved_meals: Vec<MealEntry> = Vec::new();
    let mut failed: Vec<FailedSlot> = Vec::new();
    for entry in plan["meals"].as_array().cloned().unwrap_or_default() {
        let date = serde_json::from_value(entry["date"].clone()).unwrap_or(plan_start);
        let meal_name = entry["meal_name"].as_str().unwrap_or_default().to_string();
        let slot = plnd_data::models::OpenSlot { date, meal_name: meal_name.clone() };
        match resolve_slot_meal(&state, user_id, date, &meal_name, &entry, || {
            let mut c = build_suggest_slot_ctx(user_id, &slot, &prefs_blob, &locked_entries, &[]);
            c.constrained_to_existing = true;
            c
        }).await {
            Ok(m) => resolved_meals.push(m),
            Err(f) => failed.push(f),
        }
    }
```

Build the final `MealPlanResponse` from `resolved_meals` (+ `failed`), preserving the existing title-resolution + `nutrition_summary` steps.

> Reuse the existing `preload_meal_pref_context` to get `prefs_blob` and the existing locked-set construction. Keep the response shape identical to today's so the client is unaffected.

- [ ] **Step 2: Build + run**

Run: `just verify-build`
Expected: compiles.
Run: `cd plnd_api && cargo test --lib routes::agent`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_api/src/routes/agent.rs
git -C "$(git rev-parse --show-toplevel)" commit -m "feat(api): promote invented meals in the rebalance handler"
```

---

## Phase 6 — End-to-end

### Task 13: E2E — invented meal is promoted and rendered

The e2e policy allows mocking the LLM/agent. Mock the agent meal-plan endpoint to return a slot with a `new` meal_ref; the **real backend** promotion runs against the fixture providers (TheMealDB/USDA/OFF already wired under `just verify`). Assert the wizard renders the resulting meal with a title.

**Files:**
- Create: `plnd_client/e2e/meal-plan-invented-meal.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
import { test, expect } from '@playwright/test';
import { seedAuth, seedOnboarding } from './helpers/auth';

test('an invented meal is promoted into the catalog and rendered in the wizard', async ({ page }) => {
  await seedAuth(page);
  await seedOnboarding(page);

  // Mock ONLY the agent's per-slot suggestion to invent a meal. The backend's
  // promotion + catalog ingest run for real against the fixture providers.
  await page.route('**/agent/meal-plan', async (route) => {
    const json = {
      plan_start: '2026-06-15',
      meals: [
        {
          date: '2026-06-15',
          meal_name: 'dinner',
          meal_ref: {
            type: 'new',
            name: 'Chicken Handi',
            occasion_tags: ['dinner'],
            inferred_ingredients: [{ name: 'chicken', grams: 200 }],
            estimated_nutrition: { kcal: 600, protein_g: 45, carbs_g: 20, fat_g: 35 },
          },
        },
      ],
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });

  // Navigate to the planning wizard and trigger plan generation.
  await page.goto('/plan');
  // (Adjust selectors to the real wizard entry — reuse the existing planning-wizard spec's flow.)
  await page.getByRole('button', { name: /generate|plan my week/i }).click();

  // The promoted meal should render with its resolved catalog title.
  await expect(page.getByText(/handi|chicken/i)).toBeVisible({ timeout: 15000 });
});
```

> Mirror the existing `plnd_client/e2e/planning-wizard*.spec.ts` for the exact wizard navigation/selectors and the right route URL (`**/agent/meal-plan` vs `**/agent/meal-plan/rebalance`). If `/agent/meal-plan` is the per-slot fan-out (which mocking at the HTTP boundary bypasses the real promotion), instead mock at the LLM boundary the suite already uses, so the real route + promotion execute. Match whatever boundary the existing meal-plan e2e mocks.

- [ ] **Step 2: Run the e2e test**

Run (API must be up — `just verify` does this, or `just dev` then): `cd plnd_client && npx playwright test meal-plan-invented-meal`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add plnd_client/e2e/meal-plan-invented-meal.spec.ts
git -C "$(git rev-parse --show-toplevel)" commit -m "test(e2e): invented meal promoted and rendered in the wizard"
```

---

### Task 14: Full verification + MSRV

- [ ] **Step 1: Run the full pipeline**

Run: `just verify`
Expected: all quality + build + unit + e2e gates PASS. Fix any failure before proceeding (a failing test is never acceptable).

- [ ] **Step 2: MSRV check (if any new language features were used)**

Run: `just msrv`
Expected: PASS. If a new feature bumped the compiler requirement, update the affected crate's `rust-version` and re-run.

- [ ] **Step 3: Final commit (if verify produced fmt/clippy fixes)**

```bash
git -C "$(git rev-parse --show-toplevel)" add -A
git -C "$(git rev-parse --show-toplevel)" commit -m "chore: verification fixes for invented-meal promotion"
```

---

## Self-Review

**Spec coverage**
- Backend interception ⇒ Tasks 8-12 (agent emits `new`; API promotes post-run). ✓
- Synchronous ⇒ promotion runs inline in the request path (Tasks 10-12). ✓
- Shared catalog ⇒ `ingest_dish`/`ingest_meal` write `catalog_*` (Tasks 1-3, 9). ✓
- Miss ⇒ re-invoke constrained ⇒ `constrained_to_existing` flag (Task 7) + `resolve_slot_meal` retry (Tasks 10-12). ✓
- Match scope "both" ⇒ recipe-first then ingredient compose in `promote_new_meal` (Task 9). ✓
- `llm_composed` tag + `contributed_by_user_id`, surfaced immediately ⇒ Task 9 ingredient branch; no visibility filter added. ✓
- Out-of-scope (adhoc resolve, background jobs, browse UI, visibility gating) ⇒ untouched. ✓

**Placeholder scan** — no TBD/TODO; every code step shows code; provider/DTO assumptions flagged inline with verification notes.

**Type consistency** — `IngestDishInput`/`IngestMealInput`/`DishIngredientLinkInput`/`MealDishLinkInput` defined in Task 3 and consumed identically in Task 9; `RawMealRef`/`NewMealProposal`/`PromotionOutcome` defined in Task 8, consumed in Tasks 9-12; `resolve_dish`/`resolve_ingredient` defined in Task 4, consumed in Task 9; `existing_ref_outcome`/`resolve_slot_meal` defined in Task 10, reused in Tasks 11-12.

**Known risk to verify during execution** — the exact prompt-assembly seam for the `constrained_to_existing` directive (Task 7 Step 3) and the precise e2e mock boundary (Task 13) are the two spots most likely to need adjustment against the live code; both are flagged with `>` notes.
