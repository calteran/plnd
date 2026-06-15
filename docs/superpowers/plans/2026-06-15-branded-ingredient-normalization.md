# Branded Ingredient Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user promotes a branded ingredient (Open Food Facts / USDA Branded), split its branded name into a clean generic `name` plus a structured `brand` via one LLM call, so branded foods become searchable under generic names with brand provenance preserved.

**Architecture:** A `BrandNormalizer` trait in `plnd_agent` with a live LLM impl (`LlmBrandNormalizer`, one `Fast`-tier completion) and a fixture impl (`FixtureBrandNormalizer`) selected by the existing `#[cfg(debug_assertions)]` + `fixture_path` gate. The `/catalog/ingredients/promote` route (the only path branded foods enter the catalog) calls the normalizer for non-canonical sources, applies a confidence gate, and writes a new nullable `brand` column. Branded rows stay non-canonical, so a mislabel only mis-names a fallback-lane row.

**Tech Stack:** Rust, Axum, sqlx/PostgreSQL, async-trait. Existing `LlmProvider`/`ProviderRegistry`/`MockLlmProvider` in `plnd_agent`. Fixture-backed determinism per `docs/architecture.md` §9.7.

**Spec:** `docs/superpowers/specs/2026-06-15-branded-ingredient-normalization-design.md`

---

## File Structure

**Create:**
- `plnd_data/migrations/0048_catalog_ingredient_brand.sql` — add `brand` column + recreate FTS index.
- `plnd_agent/src/brand_normalizer.rs` — `Normalization`, `BrandNormalizer` trait, confidence gate, `LlmBrandNormalizer`, `FixtureBrandNormalizer`.
- `plnd_data/fixtures/brand_normalization.json` — deterministic name→split map for e2e/integration.
- `plnd_client/e2e/branded-ingredient-normalization.spec.ts` — e2e coverage.

**Modify:**
- `plnd_agent/src/lib.rs` — export the new types.
- `plnd_data/src/models/catalog.rs` — `CatalogIngredient.brand`.
- `plnd_data/src/models/search.rs` — `LocalIngredientResult.brand`.
- `plnd_data/src/db/catalog_ingest.rs` — `IngestIngredientParams.brand` + INSERT.
- `plnd_data/src/db/catalog_details.rs` — `get_ingredient` SELECT list.
- `plnd_data/src/db/search.rs` — `search_ingredients` + `search_ingredient_nutrition` SELECT lists.
- `plnd_data/src/repository/catalog_ingest.rs` — `IngestIngredientInput.brand`.
- `plnd_data/src/repository/pg/catalog_ingest.rs` — pass `brand` through.
- `plnd_api/src/state.rs` — `AppState.brand_normalizer`.
- `plnd_api/src/main.rs` — `build_brand_normalizer` + wire into `AppState`.
- `plnd_api/src/routes/catalog_ingest.rs` — promote applies normalization; `ingest_input_from_detail` gains `brand`.

---

## Task 1: Schema migration + model field

Adds the nullable `brand` column and rebuilds the FTS index to include it. Updates the two explicit `SELECT` column lists that map to `CatalogIngredient` so the workspace still compiles.

**Files:**
- Create: `plnd_data/migrations/0048_catalog_ingredient_brand.sql`
- Modify: `plnd_data/src/models/catalog.rs:11-25`
- Modify: `plnd_data/src/db/catalog_details.rs:18-22`
- Modify: `plnd_data/src/db/search.rs:126-131`

- [ ] **Step 1: Write the migration**

Create `plnd_data/migrations/0048_catalog_ingredient_brand.sql`:

```sql
-- Migration 0048: brand provenance for branded-ingredient normalization (#913).
-- Branded products (Open Food Facts / USDA Branded) are promoted under a clean
-- generic `name`; the extracted brand lives here. NULL for canonical (USDA
-- Foundation/SR Legacy) and user-contributed rows. Forward-only: the dev DB is
-- rebuilt each boot, so no backfill of existing rows is required.
ALTER TABLE catalog_ingredients
    ADD COLUMN brand VARCHAR(100);

-- Recreate the FTS index to include `brand` so a brand-token query (e.g.
-- "Great Value") still matches after the brand moves out of `name`. The clean
-- generic `name` continues to drive the exact/prefix ranking in search_ingredients.
DROP INDEX idx_catalog_ingredients_fts;
CREATE INDEX idx_catalog_ingredients_fts ON catalog_ingredients
    USING GIN (to_tsvector('english',
        name || ' ' || COALESCE(brand, '') || ' ' || COALESCE(description, '')));
```

- [ ] **Step 2: Add `brand` to the model**

In `plnd_data/src/models/catalog.rs`, add the field to `CatalogIngredient` (after `external_source`, before `contributed_by_user_id`):

```rust
    pub external_id: Option<String>,
    pub external_source: Option<String>, // 'usda_fdc' | 'openfoodfacts' | null
    /// Generic-name normalization: the brand extracted from a branded source
    /// (e.g. "Great Value"). NULL for canonical and user-contributed rows.
    pub brand: Option<String>,
    pub contributed_by_user_id: Option<Uuid>,
```

- [ ] **Step 3: Update the two explicit `CatalogIngredient` SELECT lists**

In `plnd_data/src/db/catalog_details.rs` `get_ingredient`, add `brand` to the column list:

```rust
    sqlx::query_as::<_, CatalogIngredient>(
        "SELECT ingredient_id, name, description, serving_size_g, nutrition, allergens, occasion_tags, \
         external_id, external_source, brand, contributed_by_user_id, created_at, updated_at \
         FROM catalog_ingredients WHERE ingredient_id = $1",
    )
```

In `plnd_data/src/db/search.rs` `search_ingredient_nutrition`, add `brand` to the column list:

```rust
        SELECT ingredient_id, name, description, serving_size_g, nutrition,
               allergens, occasion_tags, external_id, external_source, brand,
               contributed_by_user_id, created_at, updated_at
        FROM catalog_ingredients
```

> Column order must match the `SELECT` list to `CatalogIngredient` field mapping for `sqlx::FromRow` (it maps by name, not position, but keep order consistent with the struct for readability).

- [ ] **Step 4: Verify the workspace builds**

Run: `just verify-build`
Expected: compiles with no errors (existing tests unaffected; new column is nullable).

- [ ] **Step 5: Commit**

```bash
git add plnd_data/migrations/0048_catalog_ingredient_brand.sql plnd_data/src/models/catalog.rs plnd_data/src/db/catalog_details.rs plnd_data/src/db/search.rs
git commit -m "feat(catalog): add nullable brand column + brand-aware FTS index (#913)"
```

---

## Task 2: DB ingest writes `brand`

Threads `brand` through the ingest input types and the `INSERT`, with a `sqlx::test` proving round-trip and that two brands sharing a generic name coexist.

**Files:**
- Modify: `plnd_data/src/db/catalog_ingest.rs:8-17` (params), `:29-57` (INSERT), tests at `:282`
- Modify: `plnd_data/src/repository/catalog_ingest.rs:6-15` (input)
- Modify: `plnd_data/src/repository/pg/catalog_ingest.rs:28-44` (mapping)

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `plnd_data/src/db/catalog_ingest.rs`:

```rust
    #[sqlx::test(migrations = "./migrations")]
    async fn ingest_ingredient_stores_brand_and_brands_share_generic_name(pool: PgPool) {
        let great_value = ingest_ingredient(
            &pool,
            IngestIngredientParams {
                external_source: "openfoodfacts",
                external_id: "off-1",
                name: "Cheddar cheese",
                description: None,
                serving_size_g: None,
                nutrition: None,
                allergens: &[],
                occasion_tags: &[],
                brand: Some("Great Value"),
            },
        )
        .await
        .unwrap();

        let kraft = ingest_ingredient(
            &pool,
            IngestIngredientParams {
                external_source: "openfoodfacts",
                external_id: "off-2",
                name: "Cheddar cheese",
                description: None,
                serving_size_g: None,
                nutrition: None,
                allergens: &[],
                occasion_tags: &[],
                brand: Some("Kraft"),
            },
        )
        .await
        .unwrap();

        assert_ne!(great_value, kraft, "distinct external ids → distinct rows");

        let brand: Option<String> =
            sqlx::query_scalar("SELECT brand FROM catalog_ingredients WHERE ingredient_id = $1")
                .bind(great_value)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(brand.as_deref(), Some("Great Value"));

        let shared: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM catalog_ingredients WHERE name = 'Cheddar cheese'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(shared, 2, "both brands coexist under one generic name");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p plnd_data --lib db::catalog_ingest::tests::ingest_ingredient_stores_brand_and_brands_share_generic_name`
Expected: FAIL to compile — `IngestIngredientParams` has no field `brand`.

- [ ] **Step 3: Add `brand` to `IngestIngredientParams` and the INSERT**

In `plnd_data/src/db/catalog_ingest.rs`, add the field to the struct:

```rust
pub struct IngestIngredientParams<'a> {
    pub external_source: &'a str,
    pub external_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub serving_size_g: Option<Decimal>,
    pub nutrition: Option<Value>,
    pub allergens: &'a [String],
    pub occasion_tags: &'a [String],
    pub brand: Option<&'a str>,
}
```

Update the `INSERT` in `ingest_ingredient` to include `brand` as `$9` (the existing trailing `external_source`/`external_id` binds become `$10`/`$11`; renumber the SELECT's `WHERE` accordingly):

```rust
    sqlx::query_as::<_, (Uuid,)>(
        r#"
        WITH ins AS (
            INSERT INTO catalog_ingredients
                (name, description, serving_size_g, nutrition, allergens, occasion_tags,
                 brand, external_source, external_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (external_source, external_id) DO NOTHING
            RETURNING ingredient_id
        )
        SELECT ingredient_id FROM ins
        UNION ALL
        SELECT ingredient_id FROM catalog_ingredients
        WHERE external_source = $8 AND external_id = $9
        LIMIT 1
        "#,
    )
    .bind(params.name)
    .bind(params.description)
    .bind(params.serving_size_g)
    .bind(params.nutrition)
    .bind(params.allergens)
    .bind(params.occasion_tags)
    .bind(params.brand)
    .bind(params.external_source)
    .bind(params.external_id)
    .fetch_one(pool)
    .await
    .map_err(DatabaseError::from)
    .map(|(id,)| id)
```

> `ON CONFLICT DO NOTHING` is preserved: re-promoting the same `(source, id)` keeps the first-written row (and its brand) unchanged. This matches existing idempotency semantics.

Update the three existing call sites of `IngestIngredientParams` in this file's tests (the `ingest_dish_links_resolvable_ingredients` test at `:363` builds one) to add `brand: None,`.

- [ ] **Step 4: Add `brand` to the repository input type and pg mapping**

In `plnd_data/src/repository/catalog_ingest.rs`, add to `IngestIngredientInput`:

```rust
pub struct IngestIngredientInput {
    pub external_source: String,
    pub external_id: String,
    pub name: String,
    pub description: Option<String>,
    pub serving_size_g: Option<Decimal>,
    pub nutrition: Option<Value>,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub brand: Option<String>,
}
```

In `plnd_data/src/repository/pg/catalog_ingest.rs` `ingest_ingredient`, pass it through:

```rust
            IngestIngredientParams {
                external_source: &input.external_source,
                external_id: &input.external_id,
                name: &input.name,
                description: input.description.as_deref(),
                serving_size_g: input.serving_size_g,
                nutrition: input.nutrition,
                allergens: &input.allergens,
                occasion_tags: &input.occasion_tags,
                brand: input.brand.as_deref(),
            },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test -p plnd_data --lib db::catalog_ingest::tests::ingest_ingredient_stores_brand_and_brands_share_generic_name`
Expected: PASS.

> This will surface compile errors at every other `IngestIngredientInput { .. }` literal (in `plnd_api/src/routes/meal_promotion.rs` and `catalog_ingest.rs`, and their tests). Add `brand: None,` to each. Re-run `just verify-build` until clean.

- [ ] **Step 6: Commit**

```bash
git add plnd_data/src/db/catalog_ingest.rs plnd_data/src/repository/catalog_ingest.rs plnd_data/src/repository/pg/catalog_ingest.rs plnd_api/src/routes/meal_promotion.rs plnd_api/src/routes/catalog_ingest.rs
git commit -m "feat(catalog): write brand through ingest path (#913)"
```

---

## Task 3: Surface `brand` in ingredient search

Adds `brand` to the local search projection + result type, and proves a brand-token query hits via the new FTS index.

**Files:**
- Modify: `plnd_data/src/models/search.rs:8-16`
- Modify: `plnd_data/src/db/search.rs:18-51` (`search_ingredients`)

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `plnd_data/src/db/search.rs`:

```rust
    #[sqlx::test(migrations = "./migrations")]
    async fn search_ingredients_matches_brand_token_and_returns_brand(pool: PgPool) {
        sqlx::query(
            "INSERT INTO catalog_ingredients (name, brand, external_source, external_id, allergens, occasion_tags) \
             VALUES ('Cheddar cheese', 'Great Value', 'openfoodfacts', 'off-1', '{}', '{}')",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Brand token alone must match via the brand-aware FTS index.
        let by_brand = search_ingredients(&pool, "Great Value", 10, &[], None)
            .await
            .unwrap();
        assert_eq!(by_brand.len(), 1, "brand token should match");
        assert_eq!(by_brand[0].name, "Cheddar cheese");
        assert_eq!(by_brand[0].brand.as_deref(), Some("Great Value"));
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p plnd_data --lib db::search::tests::search_ingredients_matches_brand_token_and_returns_brand`
Expected: FAIL to compile — `LocalIngredientResult` has no field `brand`.

- [ ] **Step 3: Add `brand` to `LocalIngredientResult`**

In `plnd_data/src/models/search.rs`:

```rust
pub struct LocalIngredientResult {
    pub ingredient_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub allergens: Vec<String>,
    pub occasion_tags: Vec<String>,
    pub external_source: Option<String>,
    pub brand: Option<String>,
}
```

- [ ] **Step 4: Add `brand` to the `search_ingredients` projection**

In `plnd_data/src/db/search.rs` `search_ingredients`, add `brand` to the `SELECT`:

```rust
        SELECT ingredient_id, name, description,
               allergens, occasion_tags, external_source, brand
        FROM catalog_ingredients
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test -p plnd_data --lib db::search::tests::search_ingredients_matches_brand_token_and_returns_brand`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plnd_data/src/models/search.rs plnd_data/src/db/search.rs
git commit -m "feat(catalog): surface brand in ingredient search results (#913)"
```

---

## Task 4: `BrandNormalizer` trait, gate, and fixture impl

Defines the normalization domain types in `plnd_agent`: the result struct, the confidence gate (pure), the trait, and the deterministic fixture impl. Live LLM impl comes in Task 5.

**Files:**
- Create: `plnd_agent/src/brand_normalizer.rs`
- Modify: `plnd_agent/src/lib.rs:1-12`

- [ ] **Step 1: Write the failing tests**

Create `plnd_agent/src/brand_normalizer.rs`:

```rust
//! Generic/brand name normalization for branded ingredient ingest (#913).
//!
//! Branded sources (Open Food Facts, USDA Branded) carry composite names like
//! "Great Value Shredded Cheddar Cheese". On promotion we split that into a
//! clean generic `name` plus a structured `brand`, gated by a confidence score
//! so uncertain or brand-less splits leave the original name untouched.

use std::collections::HashMap;
use std::path::Path;

use async_trait::async_trait;
use serde::Deserialize;

/// Minimum LLM confidence required to replace a branded name with its generic
/// form. Below this (or when no brand is detected) the original name is kept.
/// Branded rows stay non-canonical, so a wrong split only mis-names a
/// fallback-lane row — never the canonical layer; a light gate is sufficient.
pub const BRAND_CONFIDENCE_THRESHOLD: f64 = 0.7;

/// A single normalization result: the generic food name, an optional brand, and
/// the model's confidence in the split (0.0–1.0).
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Normalization {
    pub generic_name: String,
    pub brand: Option<String>,
    pub confidence: f64,
}

impl Normalization {
    /// Apply the confidence + brand-presence gate, returning the `(name, brand)`
    /// to persist. Accepts the split only when confidence clears the threshold
    /// and a non-empty brand is present; otherwise keeps the original name.
    pub fn gated(&self, original_name: &str) -> (String, Option<String>) {
        match &self.brand {
            Some(b)
                if self.confidence >= BRAND_CONFIDENCE_THRESHOLD
                    && !b.trim().is_empty()
                    && !self.generic_name.trim().is_empty() =>
            {
                (self.generic_name.clone(), Some(b.trim().to_string()))
            }
            _ => (original_name.to_string(), None),
        }
    }
}

/// Splits a branded ingredient name into a generic name + brand. Returns `None`
/// when normalization could not be performed (LLM error, parse failure, or no
/// fixture entry) — callers fall back to the original name.
#[async_trait]
pub trait BrandNormalizer: Send + Sync {
    async fn normalize(&self, branded_name: &str) -> Option<Normalization>;
}

/// Deterministic normalizer backed by a JSON map of `branded_name → Normalization`.
/// Used in debug builds (e2e + integration tests) so promotion never makes a
/// live LLM call. Selected by the `fixture_path` gate in `plnd_api::main`.
pub struct FixtureBrandNormalizer {
    entries: HashMap<String, Normalization>,
}

impl FixtureBrandNormalizer {
    /// Load the fixture map from a JSON file shaped as
    /// `{ "<branded name>": { "generic_name": "...", "brand": "...", "confidence": 0.9 } }`.
    pub fn from_path(path: &Path) -> std::io::Result<Self> {
        let raw = std::fs::read_to_string(path)?;
        let entries: HashMap<String, Normalization> = serde_json::from_str(&raw)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        Ok(Self { entries })
    }

    /// Build directly from entries (used by tests).
    pub fn from_entries(entries: HashMap<String, Normalization>) -> Self {
        Self { entries }
    }
}

#[async_trait]
impl BrandNormalizer for FixtureBrandNormalizer {
    async fn normalize(&self, branded_name: &str) -> Option<Normalization> {
        self.entries.get(branded_name).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gated_accepts_confident_branded_split() {
        let n = Normalization {
            generic_name: "Cheddar cheese".into(),
            brand: Some("Great Value".into()),
            confidence: 0.9,
        };
        assert_eq!(
            n.gated("Great Value Shredded Cheddar Cheese"),
            ("Cheddar cheese".into(), Some("Great Value".into()))
        );
    }

    #[test]
    fn gated_keeps_original_when_below_threshold() {
        let n = Normalization {
            generic_name: "Cheddar cheese".into(),
            brand: Some("Great Value".into()),
            confidence: 0.5,
        };
        assert_eq!(
            n.gated("Great Value Shredded Cheddar Cheese"),
            ("Great Value Shredded Cheddar Cheese".into(), None)
        );
    }

    #[test]
    fn gated_keeps_original_when_no_brand() {
        let n = Normalization {
            generic_name: "Greek yogurt".into(),
            brand: None,
            confidence: 0.95,
        };
        assert_eq!(
            n.gated("Greek yogurt"),
            ("Greek yogurt".into(), None)
        );
    }

    #[tokio::test]
    async fn fixture_returns_entry_or_none() {
        let mut map = HashMap::new();
        map.insert(
            "Great Value Shredded Cheddar Cheese".to_string(),
            Normalization {
                generic_name: "Cheddar cheese".into(),
                brand: Some("Great Value".into()),
                confidence: 0.92,
            },
        );
        let norm = FixtureBrandNormalizer::from_entries(map);
        assert!(norm.normalize("Great Value Shredded Cheddar Cheese").await.is_some());
        assert!(norm.normalize("Unknown Product").await.is_none());
    }
}
```

- [ ] **Step 2: Export from the crate**

In `plnd_agent/src/lib.rs`, add the module and re-exports:

```rust
pub mod agent;
pub mod brand_normalizer;
pub mod config;
pub mod context;
pub mod provider;
pub(crate) mod tools;

pub use agent::{AgentError, AgentOutput, AgentService, xml_escape};
pub use brand_normalizer::{
    BRAND_CONFIDENCE_THRESHOLD, BrandNormalizer, FixtureBrandNormalizer, Normalization,
};
pub use config::LlmConfig;
pub use context::{AgentContext, UseCase};
pub use tools::{Tool, ToolContext, ToolError};
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cargo test -p plnd_agent --lib brand_normalizer`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add plnd_agent/src/brand_normalizer.rs plnd_agent/src/lib.rs
git commit -m "feat(agent): BrandNormalizer trait, confidence gate, fixture impl (#913)"
```

---

## Task 5: `LlmBrandNormalizer` (live LLM impl)

A one-shot `Fast`-tier completion that forces a single structured tool call. Tested with `MockLlmProvider` — no network.

**Files:**
- Modify: `plnd_agent/src/brand_normalizer.rs`

- [ ] **Step 1: Write the failing tests**

Add to `plnd_agent/src/brand_normalizer.rs` (top-level `use` additions, the struct, and tests):

```rust
use std::sync::Arc;

use crate::provider::{
    CompletionRequest, LlmProvider, Message, MessageContent, MessageRole, ToolDefinition,
};

/// System prompt instructing the model to split a branded food name.
const NORMALIZE_SYSTEM_PROMPT: &str = "You normalize branded grocery product names into a generic food name plus a brand. \
Given a single product name, call the report_normalization tool exactly once. \
The generic_name must be the plain food (e.g. \"Cheddar cheese\"), with no brand, size, or marketing words. \
The brand is the manufacturer or store brand (e.g. \"Great Value\"); use null if the name has no brand. \
confidence is your certainty (0.0-1.0) that the split is correct.";

fn report_normalization_tool() -> ToolDefinition {
    ToolDefinition {
        name: "report_normalization".to_string(),
        description: "Report the generic name, brand, and confidence for a product name.".to_string(),
        schema: serde_json::json!({
            "type": "object",
            "properties": {
                "generic_name": { "type": "string" },
                "brand": { "type": ["string", "null"] },
                "confidence": { "type": "number" }
            },
            "required": ["generic_name", "confidence"]
        }),
    }
}

/// Live normalizer backed by a `Fast`-tier LLM provider. One completion per call.
pub struct LlmBrandNormalizer {
    provider: Arc<dyn LlmProvider>,
    max_tokens: u32,
}

impl LlmBrandNormalizer {
    pub fn new(provider: Arc<dyn LlmProvider>) -> Self {
        Self {
            provider,
            max_tokens: 256,
        }
    }
}

#[async_trait]
impl BrandNormalizer for LlmBrandNormalizer {
    async fn normalize(&self, branded_name: &str) -> Option<Normalization> {
        let request = CompletionRequest {
            system: NORMALIZE_SYSTEM_PROMPT.to_string(),
            messages: vec![Message {
                role: MessageRole::User,
                content: MessageContent::Text(branded_name.to_string()),
                tool_calls: vec![],
            }],
            tools: vec![report_normalization_tool()],
            max_tokens: self.max_tokens,
        };

        let completion = match self.provider.complete(request).await {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(error = %e, branded_name, "brand normalization LLM call failed");
                return None;
            }
        };

        let call = completion.response.tool_calls.into_iter().next()?;
        match serde_json::from_value::<Normalization>(call.arguments) {
            Ok(n) => Some(n),
            Err(e) => {
                tracing::warn!(error = %e, branded_name, "brand normalization parse failed");
                None
            }
        }
    }
}
```

Add these tests to the `tests` module:

```rust
    use crate::provider::mock::MockLlmProvider;
    use crate::provider::{CompletionResponse, LlmError, StopReason, ToolCall};

    fn tool_call_response(args: serde_json::Value) -> CompletionResponse {
        CompletionResponse {
            content: None,
            tool_calls: vec![ToolCall {
                id: "call-1".into(),
                name: "report_normalization".into(),
                arguments: args,
            }],
            stop_reason: StopReason::ToolUse,
            usage: None,
        }
    }

    #[tokio::test]
    async fn llm_normalizer_parses_tool_call() {
        let mock = MockLlmProvider::new("fast");
        mock.push_response(tool_call_response(serde_json::json!({
            "generic_name": "Cheddar cheese",
            "brand": "Great Value",
            "confidence": 0.9
        })));
        let norm = LlmBrandNormalizer::new(Arc::new(mock));
        let result = norm.normalize("Great Value Shredded Cheddar Cheese").await;
        assert_eq!(
            result,
            Some(Normalization {
                generic_name: "Cheddar cheese".into(),
                brand: Some("Great Value".into()),
                confidence: 0.9,
            })
        );
    }

    #[tokio::test]
    async fn llm_normalizer_returns_none_on_error() {
        let mock = MockLlmProvider::new("fast");
        mock.push_error(LlmError::Api { status: 500, message: "boom".into() });
        let norm = LlmBrandNormalizer::new(Arc::new(mock));
        assert!(norm.normalize("anything").await.is_none());
    }

    #[tokio::test]
    async fn llm_normalizer_returns_none_when_no_tool_call() {
        let mock = MockLlmProvider::new("fast");
        mock.push_response(CompletionResponse {
            content: Some("I cannot".into()),
            tool_calls: vec![],
            stop_reason: StopReason::EndTurn,
            usage: None,
        });
        let norm = LlmBrandNormalizer::new(Arc::new(mock));
        assert!(norm.normalize("anything").await.is_none());
    }
```

> Confirm the `mock` module path is reachable from this crate's tests. `plnd_agent/src/provider/mod.rs` declares `#[cfg(any(test, feature = "test-utils"))] pub mod mock;`, so `crate::provider::mock::MockLlmProvider` is available under `cfg(test)`. Re-export `LlmBrandNormalizer` from `lib.rs` alongside the others (add it to the `pub use brand_normalizer::{...}` list).

- [ ] **Step 2: Run the tests to verify they fail, then pass**

Run: `cargo test -p plnd_agent --lib brand_normalizer`
Expected: first FAIL to compile (type missing), then after adding the impl above, PASS (7 tests total).

- [ ] **Step 3: Commit**

```bash
git add plnd_agent/src/brand_normalizer.rs plnd_agent/src/lib.rs
git commit -m "feat(agent): LlmBrandNormalizer one-shot fast-tier impl (#913)"
```

---

## Task 6: Wire the normalizer into `AppState` + `main.rs`

Adds the normalizer to shared state and a `build_brand_normalizer` selector mirroring `build_nutrition_providers`.

**Files:**
- Modify: `plnd_api/src/state.rs:1-32`
- Modify: `plnd_api/src/main.rs` (new fn near `build_nutrition_providers` ~`:541`; construction near `:232`; `AppState` literal `:234`)

- [ ] **Step 1: Add the field to `AppState`**

In `plnd_api/src/state.rs`, add the import and field:

```rust
use plnd_agent::{AgentService, BrandNormalizer};
use std::sync::Arc;
```

```rust
    pub agent: AgentService,
    /// Splits branded ingredient names into generic name + brand on promotion (#913).
    pub brand_normalizer: Arc<dyn BrandNormalizer>,
    pub meal_plan_concurrency: usize,
```

- [ ] **Step 2: Add the `build_brand_normalizer` selector**

In `plnd_api/src/main.rs`, add near `build_nutrition_providers`:

```rust
/// Constructs the brand normalizer for the promote path (#913).
///
/// In debug builds, if `external.fixture_path` is set, returns the file-backed
/// `FixtureBrandNormalizer` (deterministic, offline) so e2e never makes a live
/// LLM call. Otherwise (and always in release builds) returns the LLM-backed
/// normalizer using the fast-tier provider.
fn build_brand_normalizer(
    external: &plnd_api::config::settings::ExternalProvidersConfig,
    llm: &plnd_agent::LlmConfig,
) -> std::sync::Arc<dyn plnd_agent::BrandNormalizer> {
    #[cfg(debug_assertions)]
    if let Some(fixture_root) = &external.fixture_path {
        tracing::warn!(
            path = %fixture_root.display(),
            "USING FIXTURE BRAND NORMALIZER for /catalog/ingredients/promote — debug builds only; never enable in prod"
        );
        let path = fixture_root.join("brand_normalization.json");
        let normalizer = plnd_agent::FixtureBrandNormalizer::from_path(&path).unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to load brand-normalization fixture");
            std::process::exit(1);
        });
        return std::sync::Arc::new(normalizer);
    }
    let _ = external;
    let provider: std::sync::Arc<dyn plnd_agent::provider::LlmProvider> =
        std::sync::Arc::from(plnd_agent::agent::build_fast_provider(llm));
    std::sync::Arc::new(plnd_agent::brand_normalizer::LlmBrandNormalizer::new(provider))
}
```

> `build_provider` in `plnd_agent/src/agent/mod.rs` is private. Add a thin public wrapper so `main.rs` can build a fast-tier provider without exposing the registry. In `plnd_agent/src/agent/mod.rs`, add:
> ```rust
> /// Build a standalone fast-tier LLM provider (used by the brand normalizer).
> pub fn build_fast_provider(config: &LlmConfig) -> Box<dyn LlmProvider> {
>     build_provider(&config.fast)
> }
> ```
> and ensure `provider` and `brand_normalizer` modules are `pub` in `lib.rs` (provider already is; brand_normalizer is from Task 4).

- [ ] **Step 3: Construct and pass into `AppState`**

In `plnd_api/src/main.rs`, after `let agent = plnd_agent::AgentService::new(...)`:

```rust
    let agent = plnd_agent::AgentService::new(&config.llm, repos.clone());
    let brand_normalizer = build_brand_normalizer(&config.external_providers, &config.llm);
```

Add to the `AppState { .. }` literal:

```rust
        agent,
        brand_normalizer,
        meal_plan_concurrency: config.agent.meal_plan_concurrency,
```

- [ ] **Step 4: Verify build + server startup**

Run: `just verify-build`
Expected: compiles clean.

Run: `just test-run-server`
Expected: server starts, logs the fixture-normalizer warning (when a fixture path is configured) or boots normally, auto-kills after 15s with no panic.

- [ ] **Step 5: Commit**

```bash
git add plnd_api/src/state.rs plnd_api/src/main.rs plnd_agent/src/agent/mod.rs
git commit -m "feat(api): wire brand normalizer into AppState (#913)"
```

---

## Task 7: Promote route applies normalization

The `/catalog/ingredients/promote` handler now normalizes branded (non-canonical) names through a testable seam.

**Files:**
- Modify: `plnd_api/src/routes/catalog_ingest.rs:73-93` (`ingest_input_from_detail`), `:115-138` (`promote_ingredient`), tests at `:197`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `plnd_api/src/routes/catalog_ingest.rs`:

```rust
    use plnd_agent::{BrandNormalizer, FixtureBrandNormalizer, Normalization};
    use std::collections::HashMap;

    fn fixture_normalizer() -> FixtureBrandNormalizer {
        let mut map = HashMap::new();
        map.insert(
            "Great Value Shredded Cheddar Cheese".to_string(),
            Normalization {
                generic_name: "Cheddar cheese".into(),
                brand: Some("Great Value".into()),
                confidence: 0.95,
            },
        );
        FixtureBrandNormalizer::from_entries(map)
    }

    #[tokio::test]
    async fn resolve_skips_normalization_for_canonical_source() {
        let norm = fixture_normalizer();
        let (name, brand) =
            resolve_name_brand(true, "Cheddar cheese, low moisture", &norm).await;
        assert_eq!(name, "Cheddar cheese, low moisture");
        assert_eq!(brand, None);
    }

    #[tokio::test]
    async fn resolve_splits_branded_source() {
        let norm = fixture_normalizer();
        let (name, brand) =
            resolve_name_brand(false, "Great Value Shredded Cheddar Cheese", &norm).await;
        assert_eq!(name, "Cheddar cheese");
        assert_eq!(brand.as_deref(), Some("Great Value"));
    }

    #[tokio::test]
    async fn resolve_keeps_original_when_no_fixture_entry() {
        let norm = fixture_normalizer();
        let (name, brand) = resolve_name_brand(false, "Unmapped Branded Thing", &norm).await;
        assert_eq!(name, "Unmapped Branded Thing");
        assert_eq!(brand, None);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p plnd-api --lib routes::catalog_ingest::tests::resolve_splits_branded_source`
Expected: FAIL to compile — `resolve_name_brand` not defined.

> The crate name is `plnd_api` in `cargo test -p`; confirm with `grep '^name' plnd_api/Cargo.toml` and use that exact value.

- [ ] **Step 3: Add the `resolve_name_brand` seam and use it in the handler**

In `plnd_api/src/routes/catalog_ingest.rs`, add the helper:

```rust
/// Resolve the `(name, brand)` to persist for a promoted ingredient.
///
/// Canonical sources (USDA Foundation/SR Legacy) already carry clean names, so
/// they bypass normalization. Branded sources are split via the normalizer and
/// passed through the confidence gate; any failure keeps the original name.
async fn resolve_name_brand(
    is_canonical: bool,
    original_name: &str,
    normalizer: &dyn plnd_agent::BrandNormalizer,
) -> (String, Option<String>) {
    if is_canonical {
        return (original_name.to_string(), None);
    }
    match normalizer.normalize(original_name).await {
        Some(n) => n.gated(original_name),
        None => (original_name.to_string(), None),
    }
}
```

Change `ingest_input_from_detail` to accept the resolved name + brand:

```rust
pub(crate) fn ingest_input_from_detail(
    external_source: &str,
    detail: plnd_data::providers::dtos::ExternalIngredient,
    name: String,
    brand: Option<String>,
) -> IngestIngredientInput {
    IngestIngredientInput {
        external_source: external_source.to_string(),
        external_id: detail.external_id,
        name,
        description: None,
        serving_size_g: detail.serving_size_g,
        nutrition: detail
            .nutrition
            .as_ref()
            .and_then(|n| serde_json::to_value(n).ok()),
        allergens: detail.allergens,
        occasion_tags: vec![],
        brand,
    }
}
```

Update `promote_ingredient` to compute name+brand before ingest:

```rust
    let detail = state
        .provider_search
        .fetch_ingredient_detail(&body.external_source, &body.external_id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    let is_canonical = state
        .provider_search
        .is_canonical_source(&body.external_source);
    let (name, brand) =
        resolve_name_brand(is_canonical, &detail.name, state.brand_normalizer.as_ref()).await;
    let id = state
        .repos
        .catalog_ingest
        .ingest_ingredient(ingest_input_from_detail(&body.external_source, detail, name, brand))
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "promote_ingredient ingest error");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
```

> Update the existing `ingest_input_from_detail` unit tests (`ingest_input_from_detail_maps_nutrition_and_ids`, `..._serializes_populated_nutrition`) to pass the new args, e.g. `ingest_input_from_detail("usda_fdc", detail, "Bananas, dehydrated, or banana powder".to_string(), None)`, and assert `input.brand` where relevant.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p plnd_api --lib routes::catalog_ingest`
Expected: PASS (all catalog_ingest route tests, including the three new `resolve_*` tests).

- [ ] **Step 5: Commit**

```bash
git add plnd_api/src/routes/catalog_ingest.rs
git commit -m "feat(api): normalize branded names on promote (#913)"
```

---

## Task 8: Deterministic fixture + e2e coverage

Adds the fixture file the debug normalizer reads, then an e2e test that promotes a branded result and asserts it surfaces under its generic name.

**Files:**
- Create: `plnd_data/fixtures/brand_normalization.json`
- Create: `plnd_client/e2e/branded-ingredient-normalization.spec.ts`

- [ ] **Step 1: Identify the branded fixture name to key on**

Run: `grep -o '"name"[^,]*' plnd_data/fixtures/nutrition/open_food_facts/lookup.json | head` (or read the file) to find an exact branded product name returned by the Open Food Facts fixture lookup. Record the exact string — the fixture map key must match it byte-for-byte.

- [ ] **Step 2: Write the fixture file**

Create `plnd_data/fixtures/brand_normalization.json`, keyed by the exact branded name found in Step 1 (example shown; replace the key/values with the real fixture product):

```json
{
  "<exact OFF branded product name>": {
    "generic_name": "<clean generic, e.g. Cheddar cheese>",
    "brand": "<brand, e.g. Great Value>",
    "confidence": 0.95
  }
}
```

- [ ] **Step 3: Write the e2e test**

Create `plnd_client/e2e/branded-ingredient-normalization.spec.ts`. Follow the existing e2e auth/seed conventions (`seedAuth`, real backend for `/search` and `/catalog/*`). The flow: search for the branded product, locate the branded (non-canonical) result, POST it to `/catalog/ingredients/promote`, then assert the promoted catalog row carries the generic name + brand (via the search/local results or a catalog-detail fetch).

```typescript
import { test, expect } from '@playwright/test';
import { seedAuth } from './helpers/auth';
import { API_BASE } from './helpers/config';

test('promoting a branded ingredient stores it under a generic name with brand', async ({ page }) => {
  const token = await seedAuth(page);

  // Search for the branded product (served by the real backend + OFF fixture).
  const search = await page.request.get(
    `${API_BASE}/search/ingredients?q=<query that returns the branded fixture>`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(search.ok()).toBeTruthy();
  const body = await search.json();
  const branded = body.external.find(
    (r: { external_source: string }) => r.external_source === 'openfoodfacts',
  );
  expect(branded, 'branded fixture result present').toBeTruthy();

  // Promote it — the backend runs the fixture brand normalizer.
  const promote = await page.request.post(`${API_BASE}/catalog/ingredients/promote`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { external_source: branded.external_source, external_id: branded.external_id },
  });
  expect(promote.status()).toBe(201);

  // The promoted row is now searchable under its generic name with brand.
  const after = await page.request.get(
    `${API_BASE}/search/ingredients?q=<generic name>`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const local = (await after.json()).local as Array<{ name: string; brand: string | null }>;
  const match = local.find((r) => r.brand === '<brand>');
  expect(match, 'promoted row carries brand provenance').toBeTruthy();
  expect(match!.name).toBe('<generic name>');
});
```

> Confirm the exact helper imports (`seedAuth`, `API_BASE`) against a neighbouring spec in `plnd_client/e2e/` before finalizing — match the established import paths and seeding pattern rather than the placeholders above. Replace every `<...>` with the real query/name/brand from Steps 1–2.

- [ ] **Step 4: Commit**

```bash
git add plnd_data/fixtures/brand_normalization.json plnd_client/e2e/branded-ingredient-normalization.spec.ts
git commit -m "test(e2e): branded-ingredient normalization on promote (#913)"
```

---

## Task 9: Full verification

- [ ] **Step 1: Format and lint**

Run: `just fmt`
Then let lint autofix run. Fix any residual clippy warnings.

- [ ] **Step 2: Full pipeline**

Run: `just verify`
Expected: quality + build + unit tests + e2e all green. If the e2e test fails on a placeholder, revisit Task 8 Steps 1–3 with the real fixture values.

- [ ] **Step 3: Commit any formatting/lint fixups**

```bash
git add -A
git commit -m "chore(catalog): fmt + lint fixups for brand normalization (#913)"
```

- [ ] **Step 4: Final review before PR**

Run the code-review subagent over the branch diff (per project policy: review before opening the PR, not after). Address findings, then open the PR with "Closes #913".

---

## Self-Review Notes

- **Spec coverage:** schema/`brand` column (T1), dedup-as-per-brand-rows (T2 test proves coexistence), search surfacing + brand-token FTS (T1 index + T3), `BrandNormalizer` trait + fixture (T4), live LLM impl (T5), `#[cfg(debug_assertions)]` fixture gate wiring (T6), promote-path canonical skip + confidence gate + graceful degradation (T5 error→None, T7 `resolve_name_brand`), deterministic e2e + integration (T7 fixture-backed unit tests, T8 e2e). Offline backfill and variant-table shape are explicitly out of scope.
- **Type consistency:** `Normalization { generic_name, brand: Option<String>, confidence: f64 }`, `Normalization::gated(&self, &str) -> (String, Option<String>)`, `BrandNormalizer::normalize(&self, &str) -> Option<Normalization>`, `IngestIngredientInput.brand: Option<String>`, `IngestIngredientParams.brand: Option<&str>`, `LocalIngredientResult.brand: Option<String>`, `CatalogIngredient.brand: Option<String>`, `ingest_input_from_detail(&str, ExternalIngredient, String, Option<String>)`, `resolve_name_brand(bool, &str, &dyn BrandNormalizer)` — used consistently across tasks.
- **Open verification points for the implementer:** the `-p` crate name (`plnd_api` vs `plnd-api`); the exact `mock` module visibility under `cfg(test)`; the real OFF branded product name + e2e helper import paths (called out inline in T5/T7/T8).
