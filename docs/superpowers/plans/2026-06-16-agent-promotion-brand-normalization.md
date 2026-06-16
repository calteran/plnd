# Agent Meal-Promotion Brand Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize branded ingredients ingested via the agent meal-promotion path (`promote_new_meal`) using the existing #913 `resolve_name_brand` seam, so they are stored under clean generic names with `brand` provenance — consistent with the promote-on-select path.

**Architecture:** Reuse, not new logic. Promote the private `resolve_name_brand` helper in `catalog_ingest.rs` to `pub(crate)`, thread a `&dyn BrandNormalizer` into `promote_new_meal`, and call the seam at both ingredient-ingest sites (recipe-match branch + inferred-compose branch). Canonical USDA hits short-circuit inside `resolve_name_brand` (no LLM call); only branded fallbacks normalize, gated by confidence.

**Tech Stack:** Rust (axum, tokio), `plnd_agent::BrandNormalizer` (live `LlmBrandNormalizer` / debug `FixtureBrandNormalizer`), `cargo nextest` for unit tests, `just verify` for the full pre-commit gate.

---

## Reference: the seam being reused

`plnd_api/src/routes/catalog_ingest.rs` already defines:

```rust
async fn resolve_name_brand(
    is_canonical: bool,
    original_name: &str,
    normalizer: &dyn plnd_agent::BrandNormalizer,
) -> (String, Option<String>) {
    if is_canonical {
        return (original_name.to_string(), None);
    }
    let (name, brand) = match normalizer.normalize(original_name).await {
        Some(n) => n.gated(original_name),
        None => (original_name.to_string(), None),
    };
    // ...tracing...
    (name, brand)
}
```

`ProviderSearchService::is_canonical_source(source) -> bool` and
`resolve_ingredient(name) -> Option<(String, ExternalIngredient)>` already exist
(`plnd_data/src/search/mod.rs`). `AppState.brand_normalizer: Arc<dyn BrandNormalizer>`
already exists (`plnd_api/src/state.rs:30`).

---

## File Structure

- **Modify** `plnd_api/src/routes/catalog_ingest.rs` — change `resolve_name_brand` visibility to `pub(crate)`.
- **Modify** `plnd_api/src/routes/meal_promotion.rs` — add `normalizer` param to `promote_new_meal`; change `ingredient_input_from` signature; call the seam at both ingest sites; update existing test call sites; add the new behavior test.
- **Modify** `plnd_api/src/routes/agent.rs` — pass `state.brand_normalizer.as_ref()` to `promote_new_meal`.

---

### Task 1: Thread the normalizer through `promote_new_meal` (behavior-preserving refactor)

Make the seam reachable and wire it in at both branches, updating every call site so the workspace compiles and **all existing tests stay green** (existing test providers are non-canonical and the no-op fixture normalizer returns `None`, so the gate keeps original names — no expectation changes).

**Files:**
- Modify: `plnd_api/src/routes/catalog_ingest.rs:77`
- Modify: `plnd_api/src/routes/meal_promotion.rs:120` (`promote_new_meal`), `:272` (`ingredient_input_from`), both ingest call sites, and the six test call sites
- Modify: `plnd_api/src/routes/agent.rs:249`

- [ ] **Step 1: Make `resolve_name_brand` callable from another route module**

In `plnd_api/src/routes/catalog_ingest.rs`, change the function signature line from:

```rust
async fn resolve_name_brand(
```

to:

```rust
pub(crate) async fn resolve_name_brand(
```

(No other change to that function.)

- [ ] **Step 2: Add the `normalizer` parameter to `promote_new_meal` and import the seam**

In `plnd_api/src/routes/meal_promotion.rs`, add the import near the top (after the existing `use` lines):

```rust
use crate::routes::catalog_ingest::resolve_name_brand;
```

Change the `promote_new_meal` signature to add `normalizer` right after `ingest`:

```rust
pub async fn promote_new_meal(
    search: &ProviderSearchService,
    ingest: &dyn CatalogIngestRepository,
    normalizer: &dyn plnd_agent::BrandNormalizer,
    user_id: Uuid,
    proposal: &NewMealProposal,
) -> PromotionOutcome {
```

- [ ] **Step 3: Apply normalization at Branch 1 (recipe-match ingest site)**

In `promote_new_meal`, Branch 1 currently uses a `let`-chain:

```rust
            if let Some((ing_source, ing)) = search.resolve_ingredient(&di.name).await
                && let Ok(ingredient_id) = ingest
                    .ingest_ingredient(ingredient_input_from(&ing_source, &ing))
                    .await
            {
```

Replace it with a nested form that resolves the name/brand between the two steps:

```rust
            if let Some((ing_source, ing)) = search.resolve_ingredient(&di.name).await {
                let is_canonical = search.is_canonical_source(&ing_source);
                let (name, brand) =
                    resolve_name_brand(is_canonical, &ing.name, normalizer).await;
                if let Ok(ingredient_id) = ingest
                    .ingest_ingredient(ingredient_input_from(&ing_source, &ing, name, brand))
                    .await
                {
```

Add the matching closing brace: the existing block already closes one `if let`; add **one** extra `}` at the end of that block so both `if let`s close. (After the existing `links.push(...);` block's closing `}`, add a second `}`.)

- [ ] **Step 4: Apply normalization at Branch 2 (inferred-compose ingest site)**

Branch 2 currently uses a `let`-chain:

```rust
        if let Some((ing_source, ing)) = search.resolve_ingredient(&inferred.name).await
            && let Ok(ingredient_id) = ingest
                .ingest_ingredient(ingredient_input_from(&ing_source, &ing))
                .await
        {
```

Replace with the nested form:

```rust
        if let Some((ing_source, ing)) = search.resolve_ingredient(&inferred.name).await {
            let is_canonical = search.is_canonical_source(&ing_source);
            let (name, brand) = resolve_name_brand(is_canonical, &ing.name, normalizer).await;
            if let Ok(ingredient_id) = ingest
                .ingest_ingredient(ingredient_input_from(&ing_source, &ing, name, brand))
                .await
            {
```

Add **one** extra closing `}` at the end of that block (after the existing `links.push(...);` closing `}`) so both `if let`s close.

- [ ] **Step 5: Change `ingredient_input_from` to accept the resolved name + brand**

Replace the whole `ingredient_input_from` function:

```rust
fn ingredient_input_from(
    source: &str,
    ing: &plnd_data::providers::dtos::ExternalIngredient,
    name: String,
    brand: Option<String>,
) -> IngestIngredientInput {
    IngestIngredientInput {
        external_source: source.to_string(),
        external_id: ing.external_id.clone(),
        name,
        description: None,
        serving_size_g: None,
        nutrition: ing
            .nutrition
            .as_ref()
            .and_then(|n| serde_json::to_value(n).ok()),
        allergens: vec![],
        occasion_tags: vec![],
        brand,
    }
}
```

- [ ] **Step 6: Update the caller in `agent.rs`**

In `plnd_api/src/routes/agent.rs`, change the `promote_new_meal` call (around line 249) to pass the normalizer as the third argument:

```rust
            match promote_new_meal(
                &state.provider_search,
                state.repos.catalog_ingest.as_ref(),
                state.brand_normalizer.as_ref(),
                user_id,
                &proposal,
            )
            .await
```

- [ ] **Step 7: Add a no-op fixture normalizer helper to the test module**

In `plnd_api/src/routes/meal_promotion.rs`, inside `mod tests`, add this helper near `empty_search_service` (the helper is debug-only because `FixtureBrandNormalizer` is `#[cfg(debug_assertions)]`; tests run in debug):

```rust
    /// A normalizer that returns `None` for every name, so the confidence gate
    /// keeps the original name and `brand: None` — used to hold existing
    /// promotion tests at their pre-#940 expectations.
    fn no_op_normalizer() -> plnd_agent::FixtureBrandNormalizer {
        plnd_agent::FixtureBrandNormalizer::from_entries(std::collections::HashMap::new())
    }
```

- [ ] **Step 8: Pass the no-op normalizer at all six existing test call sites**

Update each `promote_new_meal(...)` call in `mod tests` to insert `&no_op_normalizer()` as the third argument. The six calls are in:
`promote_returns_missed_when_no_provider_resolves`, `promote_resolves_via_ingredient_composition`, `promote_resolves_via_recipe_match`, `promote_ingests_real_themealdb_fixture_recipe`, `promote_aggregates_ingredient_nutrition_scaled_by_grams`, `promote_propagates_recipe_nutrition_to_meal`.

Pattern — change e.g.:

```rust
        let out = promote_new_meal(&svc, repo.as_ref(), Uuid::new_v4(), &proposal).await;
```

to:

```rust
        let out =
            promote_new_meal(&svc, repo.as_ref(), &no_op_normalizer(), Uuid::new_v4(), &proposal)
                .await;
```

Apply the same edit (insert `&no_op_normalizer()` as the 3rd arg) to the `&svc, &repo, ...` variants too.

- [ ] **Step 9: Format, then run the existing promotion tests to verify no regression**

Run:

```bash
just fmt
cargo nextest run -p plnd_api meal_promotion
```

Expected: PASS — all existing `meal_promotion` tests green (no behavior change because the no-op normalizer returns `None`).

- [ ] **Step 10: Commit**

```bash
git add plnd_api/src/routes/catalog_ingest.rs plnd_api/src/routes/meal_promotion.rs plnd_api/src/routes/agent.rs
git commit -m "refactor(catalog): thread BrandNormalizer through promote_new_meal (#940)"
```

---

### Task 2: Prove branded normalization applies and canonical sources skip it

Add a recording repo + two test nutrition providers (one branded, one canonical) and a fixture normalizer with a real entry, then assert the new behavior.

**Files:**
- Modify: `plnd_api/src/routes/meal_promotion.rs` (test module only)

- [ ] **Step 1: Add the test fixtures (recording repo + branded/canonical providers)**

In `plnd_api/src/routes/meal_promotion.rs`, inside `mod tests`, add:

```rust
    /// Records the `(name, brand)` of each ingredient ingested, so a test can
    /// assert how the promotion path named a branded vs. canonical ingredient.
    #[derive(Default)]
    struct IngredientRecordingRepo {
        ingredients: Mutex<Vec<(String, Option<String>)>>,
    }

    #[async_trait::async_trait]
    impl CatalogIngestRepository for IngredientRecordingRepo {
        async fn ingest_ingredient(
            &self,
            i: IngestIngredientInput,
        ) -> Result<Uuid, plnd_data::Error> {
            self.ingredients.lock().unwrap().push((i.name.clone(), i.brand.clone()));
            Ok(Uuid::new_v4())
        }
        async fn contribute_ingredient(
            &self,
            _i: ContributeIngredientInput,
        ) -> Result<Uuid, plnd_data::Error> {
            Ok(Uuid::new_v4())
        }
        async fn ingest_dish(&self, _i: IngestDishInput) -> Result<Uuid, plnd_data::Error> {
            Ok(Uuid::new_v4())
        }
        async fn ingest_meal(&self, _i: IngestMealInput) -> Result<Uuid, plnd_data::Error> {
            Ok(Uuid::new_v4())
        }
    }

    /// Branded nutrition provider (non-canonical): returns a composite product name.
    struct BrandedCheddarProvider;

    #[async_trait::async_trait]
    impl NutritionProvider for BrandedCheddarProvider {
        fn source_name(&self) -> &str {
            "test_branded"
        }
        async fn search_ingredients(
            &self,
            q: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            if q.query.to_lowercase().contains("cheddar") {
                Ok(vec![SearchResult {
                    external_id: "branded-cheddar-1".into(),
                    name: "Great Value Shredded Cheddar Cheese".into(),
                    ..Default::default()
                }])
            } else {
                Ok(vec![])
            }
        }
        async fn get_ingredient_by_id(
            &self,
            _id: &str,
        ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
            Ok(Some(ExternalIngredient {
                external_id: "branded-cheddar-1".into(),
                name: "Great Value Shredded Cheddar Cheese".into(),
                serving_size_g: None,
                nutrition: None,
                allergens: vec![],
            }))
        }
    }

    /// Canonical nutrition provider: returns a clean generic name and reports
    /// `is_canonical_source() == true`, so the seam must skip normalization.
    struct CanonicalCheddarProvider;

    #[async_trait::async_trait]
    impl NutritionProvider for CanonicalCheddarProvider {
        fn source_name(&self) -> &str {
            "test_canonical"
        }
        fn is_canonical_source(&self) -> bool {
            true
        }
        async fn search_ingredients(
            &self,
            q: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            if q.query.to_lowercase().contains("cheddar") {
                Ok(vec![SearchResult {
                    external_id: "canonical-cheddar-1".into(),
                    name: "Cheddar cheese low moisture".into(),
                    ..Default::default()
                }])
            } else {
                Ok(vec![])
            }
        }
        async fn get_ingredient_by_id(
            &self,
            _id: &str,
        ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
            Ok(Some(ExternalIngredient {
                external_id: "canonical-cheddar-1".into(),
                name: "Cheddar cheese low moisture".into(),
                serving_size_g: None,
                nutrition: None,
                allergens: vec![],
            }))
        }
    }

    /// Fixture normalizer mapping the branded composite to its generic + brand,
    /// and also mapping the canonical name (to prove it is *not* consulted).
    fn cheddar_normalizer() -> plnd_agent::FixtureBrandNormalizer {
        use plnd_agent::Normalization;
        use std::collections::HashMap;
        let mut map = HashMap::new();
        map.insert(
            "Great Value Shredded Cheddar Cheese".to_string(),
            Normalization {
                generic_name: "Cheddar cheese".into(),
                brand: Some("Great Value".into()),
                confidence: 0.95,
            },
        );
        map.insert(
            "Cheddar cheese low moisture".to_string(),
            Normalization {
                generic_name: "WRONG should be skipped".into(),
                brand: Some("WRONG".into()),
                confidence: 0.99,
            },
        );
        plnd_agent::FixtureBrandNormalizer::from_entries(map)
    }
```

- [ ] **Step 2: Add the branded-normalization test**

Append to `mod tests`:

```rust
    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn promote_normalizes_branded_ingredient() {
        let repo = IngredientRecordingRepo::default();
        let svc = ProviderSearchService::new(
            vec![Arc::new(BrandedCheddarProvider)],
            vec![], // no recipe provider → inferred-compose branch
            vec![],
            plnd_data::cache::SearchCache::new(36),
        );
        let proposal = NewMealProposal {
            name: "Cheese Plate".into(),
            occasion_tags: vec!["snack".into()],
            inferred_ingredients: vec![InferredIngredient {
                // matches the branded provider's returned name (confidence 1.0)
                name: "Great Value Shredded Cheddar Cheese".into(),
                grams: 50.0,
            }],
        };

        let out = promote_new_meal(
            &svc,
            &repo,
            &cheddar_normalizer(),
            Uuid::new_v4(),
            &proposal,
        )
        .await;
        assert!(matches!(out, PromotionOutcome::Resolved { .. }), "got {out:?}");

        let recorded = repo.ingredients.lock().unwrap();
        assert_eq!(recorded.len(), 1, "exactly one ingredient ingested");
        assert_eq!(recorded[0].0, "Cheddar cheese", "branded name cleaned to generic");
        assert_eq!(recorded[0].1.as_deref(), Some("Great Value"), "brand captured");
    }
```

- [ ] **Step 3: Add the canonical-skip test**

Append to `mod tests`:

```rust
    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn promote_skips_normalization_for_canonical_ingredient() {
        let repo = IngredientRecordingRepo::default();
        let svc = ProviderSearchService::new(
            vec![Arc::new(CanonicalCheddarProvider)],
            vec![],
            vec![],
            plnd_data::cache::SearchCache::new(36),
        );
        let proposal = NewMealProposal {
            name: "Cheese Plate".into(),
            occasion_tags: vec!["snack".into()],
            inferred_ingredients: vec![InferredIngredient {
                name: "Cheddar cheese low moisture".into(),
                grams: 50.0,
            }],
        };

        let out = promote_new_meal(
            &svc,
            &repo,
            &cheddar_normalizer(),
            Uuid::new_v4(),
            &proposal,
        )
        .await;
        assert!(matches!(out, PromotionOutcome::Resolved { .. }), "got {out:?}");

        let recorded = repo.ingredients.lock().unwrap();
        assert_eq!(recorded.len(), 1, "exactly one ingredient ingested");
        // Canonical source bypasses the normalizer even though a fixture entry
        // exists for this name — original name kept, no brand.
        assert_eq!(recorded[0].0, "Cheddar cheese low moisture", "canonical name kept verbatim");
        assert_eq!(recorded[0].1, None, "no brand applied to canonical ingredient");
    }
```

- [ ] **Step 4: Format, then run the two new tests**

Run:

```bash
just fmt
cargo nextest run -p plnd_api promote_normalizes_branded_ingredient promote_skips_normalization_for_canonical_ingredient
```

Expected: PASS — both new tests green.

- [ ] **Step 5: Commit**

```bash
git add plnd_api/src/routes/meal_promotion.rs
git commit -m "test(catalog): branded normalization + canonical skip on agent promotion (#940)"
```

---

### Task 3: Full verification

- [ ] **Step 1: Run the full pre-commit gate**

Run:

```bash
just fmt
just verify
```

Expected: PASS — quality (fmt/clippy/deny/machete), build, Rust tests, and e2e all green. (No e2e change is needed: `/agent/*` is browser-mocked in e2e, so the agent promotion path is covered by the Rust tests above.)

- [ ] **Step 2: If `just verify` reports any failure, fix it before proceeding.** A failing test is never acceptable. Do not commit or open a PR until `just verify` is green.

---

## Self-Review Notes

- **Spec coverage:** seam reuse (Task 1 Steps 1-2), both branches normalized (Steps 3-4), `ingredient_input_from` carries name+brand (Step 5), caller wired (Step 6), determinism via `FixtureBrandNormalizer` (Tasks 1 & 2), branded-normalize + canonical-skip tests (Task 2). No migration/schema/frontend/e2e change — matches the spec's "Out of scope".
- **Type consistency:** new `promote_new_meal` arg order `(search, ingest, normalizer, user_id, proposal)` is used identically in `agent.rs` (Step 6) and all test calls (Task 1 Step 8, Task 2). `ingredient_input_from(source, ing, name, brand)` signature (Step 5) matches both call sites (Steps 3-4).
- **Provider defaults:** `NutritionProvider::is_canonical_source` defaults to `false`, so `BrandedCheddarProvider` is non-canonical without an override; `CanonicalCheddarProvider` overrides it to `true`.
