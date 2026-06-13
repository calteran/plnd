# Canonical Ingredient Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make USDA FDC the canonical (clean generic name) ingredient lane and Open Food Facts the branded/coverage lane, so a clean canonical ingredient is the primary result for common searches.

**Architecture:** Ingest-side data-type filtering. A `is_canonical_source()` marker on the `NutritionProvider` trait classifies providers. USDA's search is filtered to `Foundation` / `SR Legacy` data types. The startup seeder ingests only canonical sources; live search keeps all providers but orders canonical-source results ahead of branded ones. No new table, no migration, no backfill (the project has no persistent DB).

**Tech Stack:** Rust (Axum API, `plnd_data` storage/providers crate, `plnd_seed` tooling), `async-trait`, `sqlx`, USDA FDC + Open Food Facts HTTP providers, file-backed fixtures for e2e/dev.

**Spec:** `docs/superpowers/specs/2026-06-13-canonical-ingredient-catalog-design.md`

---

## Testing-command policy (read first)

This repo intentionally has **no granular Rust unit-test recipe**, and `just test` / `just test-ci` are removed. Do **not** run raw `cargo nextest` — its DB-backed tests leave orphaned Docker containers.

- During a task: use `just verify-build` to confirm compilation (fast, no Docker).
- Before each commit: run `just verify` (the authoritative gate — quality + build + unit tests + e2e). All tests must pass before committing.
- If you execute several tasks back-to-back, you may run `just verify` once before the batched commit rather than per-task — but never commit code without a green `just verify`.
- `just verify` deconflicts on port 3000 via a flock semaphore; do not kill processes on :3000.

Because there is no single-test runner, each task's "verify it fails" step means: confirm the test **compiles** (`just verify-build`) and that its assertion encodes the new behavior; the red→green transition is observed when `just verify` runs the suite at the commit checkpoint.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `plnd_data/src/providers/nutrition.rs` | `NutritionProvider` trait | Add `is_canonical_source()` default method |
| `plnd_data/src/providers/usda_fdc.rs` | USDA FDC provider | Override `is_canonical_source()` → true; filter search to canonical data types |
| `plnd_data/src/providers/open_food_facts.rs` | OFF provider | Add test asserting it inherits `false` |
| `plnd_data/src/providers/nutrition_fixture.rs` | Fixture provider (debug/e2e) | Add `canonical` field + builder; return it from `is_canonical_source()` |
| `plnd_seed/src/ingredients.rs` | Catalog ingredient seeder | Filter providers to canonical sources in `fetch_ingredients` |
| `plnd_seed/Cargo.toml` | Seeder crate manifest | Add `async-trait` dev-dependency (stub provider in tests) |
| `plnd_data/src/search/mod.rs` | `ProviderSearchService` | Add `is_canonical_source(source)` lookup method + test |
| `plnd_api/src/routes/search.rs` | Ingredient search handler | Order canonical-source external results first |
| `plnd_api/src/main.rs` | Provider wiring (fixture branch) | Mark the USDA fixture canonical |
| `plnd_data/fixtures/nutrition/usda_fdc/*.json` | Captured USDA fixture data | Refresh to canonical-only entries |

---

## Task 1: Add `is_canonical_source` marker to the provider trait

**Files:**
- Modify: `plnd_data/src/providers/nutrition.rs`
- Modify: `plnd_data/src/providers/usda_fdc.rs` (impl + test)
- Modify: `plnd_data/src/providers/open_food_facts.rs` (test)

- [ ] **Step 1: Add the failing test for USDA**

In `plnd_data/src/providers/usda_fdc.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn usda_is_a_canonical_source() {
        assert!(
            UsdaFdcProvider::new("key").is_canonical_source(),
            "USDA Foundation/SR Legacy supplies clean canonical names"
        );
    }
```

In `plnd_data/src/providers/open_food_facts.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn off_is_not_a_canonical_source() {
        assert!(
            !OpenFoodFactsProvider::default().is_canonical_source(),
            "Open Food Facts product names are branded composites, not canonical"
        );
    }
```

- [ ] **Step 2: Verify it fails to compile**

Run: `just verify-build`
Expected: compile error — no method `is_canonical_source` on `NutritionProvider`.

- [ ] **Step 3: Add the trait default method**

In `plnd_data/src/providers/nutrition.rs`, add this method to the `NutritionProvider` trait (after `source_name`):

```rust
    /// Whether this provider yields clean, generic ingredient names suitable for
    /// the canonical catalog (e.g. "Cheese, cheddar"), as opposed to branded
    /// composite product names. Canonical sources are the only ones the startup
    /// seeder ingests, and they sort ahead of branded sources in live search.
    fn is_canonical_source(&self) -> bool {
        false
    }
```

- [ ] **Step 4: Override it for USDA**

In `plnd_data/src/providers/usda_fdc.rs`, inside `impl NutritionProvider for UsdaFdcProvider`, add (next to `source_name`):

```rust
    fn is_canonical_source(&self) -> bool {
        true
    }
```

- [ ] **Step 5: Verify, then commit**

Run: `just verify`
Expected: PASS (new tests green; nothing else changes behavior).

```bash
git add plnd_data/src/providers/nutrition.rs plnd_data/src/providers/usda_fdc.rs plnd_data/src/providers/open_food_facts.rs
git commit -m "feat(providers): add is_canonical_source marker to NutritionProvider"
```

---

## Task 2: Filter USDA search to canonical data types

**Files:**
- Modify: `plnd_data/src/providers/usda_fdc.rs` (response type, helper, query, filter, tests)

USDA's search returns a `dataType` per food (`Foundation`, `SR Legacy`, `Branded`, `Survey (FNDDS)`). We request only canonical types via the API and defensively drop any non-canonical row that slips through.

- [ ] **Step 1: Write failing tests for the classifier + deserialization**

In `plnd_data/src/providers/usda_fdc.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn canonical_data_types_are_foundation_and_sr_legacy() {
        assert!(is_canonical_data_type(Some("Foundation")));
        assert!(is_canonical_data_type(Some("SR Legacy")));
        assert!(!is_canonical_data_type(Some("Branded")));
        assert!(!is_canonical_data_type(Some("Survey (FNDDS)")));
        assert!(!is_canonical_data_type(None));
    }

    #[test]
    fn search_food_deserializes_data_type() {
        let json = r#"{
            "fdcId": 1,
            "description": "ALFREDO BROCCOLI ...",
            "dataType": "Branded"
        }"#;
        let food: FdcSearchFood = serde_json::from_str(json).expect("deserialize");
        assert_eq!(food.data_type.as_deref(), Some("Branded"));
        assert!(
            !is_canonical_data_type(food.data_type.as_deref()),
            "branded composite must be classified non-canonical"
        );
    }
```

- [ ] **Step 2: Verify it fails to compile**

Run: `just verify-build`
Expected: compile error — `is_canonical_data_type` not found and `FdcSearchFood` has no `data_type` field.

- [ ] **Step 3: Add the `data_type` field to the search response type**

In `plnd_data/src/providers/usda_fdc.rs`, modify `struct FdcSearchFood`:

```rust
#[derive(Deserialize)]
struct FdcSearchFood {
    #[serde(rename = "fdcId")]
    fdc_id: i64,
    description: String,
    #[serde(rename = "foodCategory")]
    food_category: Option<String>,
    #[serde(rename = "dataType")]
    data_type: Option<String>,
}
```

- [ ] **Step 4: Add the classifier helper**

In `plnd_data/src/providers/usda_fdc.rs`, add near the top of the file (after the `use` statements):

```rust
/// USDA FDC data types that carry clean, generic ingredient names. `Branded` and
/// `Survey (FNDDS)` are excluded — they yield branded composites or mixed dishes.
fn is_canonical_data_type(data_type: Option<&str>) -> bool {
    matches!(data_type, Some("Foundation") | Some("SR Legacy"))
}
```

- [ ] **Step 5: Request canonical types and defensively filter**

In `usda_fdc.rs::search_ingredients`, change the query builder to add the `dataType` params (repeated form — USDA accepts it and reqwest encodes each pair):

```rust
            .query(&[
                ("query", query.query.as_str()),
                ("pageSize", &query.limit.to_string()),
                ("dataType", "Foundation"),
                ("dataType", "SR Legacy"),
                ("api_key", self.api_key.as_str()),
            ])
```

Then change the results mapping to drop any non-canonical row that slips through:

```rust
        let results = body
            .foods
            .into_iter()
            .filter(|f| is_canonical_data_type(f.data_type.as_deref()))
            .map(|f| SearchResult {
                external_id: f.fdc_id.to_string(),
                name: f.description,
                description: f.food_category,
                thumbnail_url: None,
            })
            .collect();
```

- [ ] **Step 6: Verify, then commit**

Run: `just verify`
Expected: PASS.

```bash
git add plnd_data/src/providers/usda_fdc.rs
git commit -m "feat(providers): filter USDA search to Foundation/SR Legacy data types"
```

---

## Task 3: Seed only canonical sources

**Files:**
- Modify: `plnd_seed/Cargo.toml` (dev-dependency)
- Modify: `plnd_seed/src/ingredients.rs` (`fetch_ingredients` + test)

- [ ] **Step 1: Add `async-trait` as a dev-dependency**

In `plnd_seed/Cargo.toml`, under `[dev-dependencies]`, add `async-trait` (matches the version used elsewhere in the workspace):

```toml
[dev-dependencies]
sqlx = { version = "0.9", features = ["macros"] }
async-trait = "0.1"
```

- [ ] **Step 2: Write the failing test (canonical-only filtering)**

In `plnd_seed/src/ingredients.rs`, replace the existing `mod tests` body's imports/contents by adding a stub provider and a filtering test. Add to `mod tests`:

```rust
    use super::*;
    use async_trait::async_trait;
    use plnd_data::providers::dtos::{ExternalIngredient, SearchQuery, SearchResult};
    use plnd_data::providers::error::ExternalProviderError;
    use plnd_data::providers::NutritionProvider;
    use std::sync::Arc;

    struct StubProvider {
        source: String,
        canonical: bool,
    }

    #[async_trait]
    impl NutritionProvider for StubProvider {
        fn source_name(&self) -> &str {
            &self.source
        }
        fn is_canonical_source(&self) -> bool {
            self.canonical
        }
        async fn search_ingredients(
            &self,
            _query: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            Ok(vec![SearchResult {
                external_id: format!("{}-1", self.source),
                name: "Stub Food".to_string(),
                description: None,
                thumbnail_url: None,
            }])
        }
        async fn get_ingredient_by_id(
            &self,
            external_id: &str,
        ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
            Ok(Some(ExternalIngredient {
                external_id: external_id.to_string(),
                name: "Stub Food".to_string(),
                serving_size_g: None,
                nutrition: None,
                allergens: vec![],
                occasion_tags: vec![],
            }))
        }
    }

    #[tokio::test]
    async fn fetch_ingredients_skips_non_canonical_providers() {
        let providers: Vec<Arc<dyn NutritionProvider>> = vec![
            Arc::new(StubProvider {
                source: "canon".to_string(),
                canonical: true,
            }),
            Arc::new(StubProvider {
                source: "branded".to_string(),
                canonical: false,
            }),
        ];

        let fetched = fetch_ingredients(&providers).await;

        assert!(
            !fetched.is_empty(),
            "the canonical provider must contribute rows"
        );
        assert!(
            fetched.iter().all(|(source, _)| source == "canon"),
            "no branded-source rows may be seeded"
        );
    }
```

Note: keep the existing `seed_terms_include_common_ingredients_and_are_deduped` test. It uses `INGREDIENT_TERMS`; the `use super::*;` import covers it (remove the now-redundant `use super::INGREDIENT_TERMS;` line if it causes an unused/duplicate-import warning).

- [ ] **Step 3: Verify it fails to compile**

Run: `just verify-build`
Expected: compile error — `fetch_ingredients` does not yet filter; test references compile but the behavior assertion will only pass after Step 4. (If it compiles, the test would FAIL at `just verify` because branded rows are currently seeded.)

- [ ] **Step 4: Filter providers to canonical sources**

In `plnd_seed/src/ingredients.rs::fetch_ingredients`, change the provider loop header to skip non-canonical providers and log it. Replace:

```rust
    for provider in providers {
        let source = provider.source_name().to_string();
```

with:

```rust
    for provider in providers {
        if !provider.is_canonical_source() {
            tracing::info!(
                provider = provider.source_name(),
                "catalog seed: skipping non-canonical source (branded names not seeded)"
            );
            continue;
        }
        let source = provider.source_name().to_string();
```

- [ ] **Step 5: Verify, then commit**

Run: `just verify`
Expected: PASS.

```bash
git add plnd_seed/Cargo.toml plnd_seed/src/ingredients.rs
git commit -m "feat(seed): ingest only canonical sources into the catalog"
```

---

## Task 4: Mark the USDA fixture provider canonical

**Files:**
- Modify: `plnd_data/src/providers/nutrition_fixture.rs` (field + builder + impl + test)
- Modify: `plnd_api/src/main.rs` (fixture wiring)

The fixture provider stands in for a real provider in debug/e2e builds. It must mirror that provider's canonical-ness so the seeder filter behaves identically offline. We add a builder method (not a new `new` param) to avoid touching the other call sites.

- [ ] **Step 1: Write the failing test**

In `plnd_data/src/providers/nutrition_fixture.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn canonical_flag_defaults_false_and_is_set_by_builder() {
        let (_tmp, provider) = fixture_provider();
        assert!(
            !provider.is_canonical_source(),
            "fixture defaults to non-canonical"
        );
        assert!(
            provider.canonical(true).is_canonical_source(),
            "builder marks the fixture canonical"
        );
    }
```

- [ ] **Step 2: Verify it fails to compile**

Run: `just verify-build`
Expected: compile error — no `canonical` field/method and no `is_canonical_source` override.

- [ ] **Step 3: Add the field, builder, and trait override**

In `plnd_data/src/providers/nutrition_fixture.rs`, modify the struct:

```rust
#[derive(Debug)]
pub struct FixtureNutritionProvider {
    source: String,
    search_path: PathBuf,
    lookup_path: PathBuf,
    canonical: bool,
}
```

In the `new` constructor, default `canonical: false` in the returned `Ok(Self { ... })`:

```rust
        Ok(Self {
            source: source.into(),
            search_path,
            lookup_path,
            canonical: false,
        })
```

Add a consuming builder method to the `impl FixtureNutritionProvider` block (after `new`):

```rust
    /// Mark this fixture as a canonical-name source (mirrors the real provider
    /// it stands in for). Defaults to `false`.
    pub fn canonical(mut self, canonical: bool) -> Self {
        self.canonical = canonical;
        self
    }
```

In `impl NutritionProvider for FixtureNutritionProvider`, add (next to `source_name`):

```rust
    fn is_canonical_source(&self) -> bool {
        self.canonical
    }
```

- [ ] **Step 4: Wire it in `main.rs`**

In `plnd_api/src/main.rs`, in the fixture branch of `build_nutrition_providers`, mark the USDA fixture canonical. Change the `make` closure usage so the USDA entry calls `.canonical(true)`. Replace:

```rust
        return vec![
            Arc::new(make("usda_fdc", "nutrition/usda_fdc")),
            Arc::new(make("openfoodfacts", "nutrition/open_food_facts")),
        ];
```

with:

```rust
        return vec![
            Arc::new(make("usda_fdc", "nutrition/usda_fdc").canonical(true)),
            Arc::new(make("openfoodfacts", "nutrition/open_food_facts")),
        ];
```

Note: `make` returns `FixtureNutritionProvider` (it already calls `.unwrap_or_else(...)`), so `.canonical(true)` chains directly before `Arc::new`.

- [ ] **Step 5: Verify, then commit**

Run: `just verify`
Expected: PASS.

```bash
git add plnd_data/src/providers/nutrition_fixture.rs plnd_api/src/main.rs
git commit -m "feat(providers): mark USDA fixture as a canonical source"
```

---

## Task 5: Expose canonical-source lookup on the search service

**Files:**
- Modify: `plnd_data/src/search/mod.rs` (method + test)

- [ ] **Step 1: Write the failing test**

In `plnd_data/src/search/mod.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn is_canonical_source_reflects_provider_marker() {
        use crate::providers::{OpenFoodFactsProvider, UsdaFdcProvider};

        let svc = ProviderSearchService::new(
            vec![
                Arc::new(UsdaFdcProvider::new("key")),
                Arc::new(OpenFoodFactsProvider::default()),
            ],
            vec![],
            vec![],
            SearchCache::new(36),
        );

        assert!(svc.is_canonical_source("usda_fdc"));
        assert!(!svc.is_canonical_source("openfoodfacts"));
        assert!(
            !svc.is_canonical_source("unknown"),
            "unknown sources default to non-canonical"
        );
    }
```

`SearchCache::new(36)` matches the existing tests in this module; `UsdaFdcProvider` and `OpenFoodFactsProvider` are re-exported from `crate::providers`. `Arc` is already imported at the top of `plnd_data/src/search/mod.rs`.

- [ ] **Step 2: Verify it fails to compile**

Run: `just verify-build`
Expected: compile error — no method `is_canonical_source` on `ProviderSearchService`.

- [ ] **Step 3: Add the method**

In `plnd_data/src/search/mod.rs`, inside `impl ProviderSearchService`, add:

```rust
    /// Whether the given source name belongs to a nutrition provider that yields
    /// canonical (generic) ingredient names. Unknown sources are treated as
    /// non-canonical so they sort after canonical results in merged output.
    pub fn is_canonical_source(&self, source: &str) -> bool {
        self.nutrition_providers
            .iter()
            .find(|p| p.source_name() == source)
            .is_some_and(|p| p.is_canonical_source())
    }
```

- [ ] **Step 4: Verify, then commit**

Run: `just verify`
Expected: PASS.

```bash
git add plnd_data/src/search/mod.rs
git commit -m "feat(search): expose canonical-source lookup on ProviderSearchService"
```

---

## Task 6: Order canonical external results ahead of branded in ingredient search

**Files:**
- Modify: `plnd_api/src/routes/search.rs` (`search_ingredients_handler`)

Only the ingredient handler changes. Dishes/exercises are untouched.

- [ ] **Step 1: Rewrite the external-result collection loop**

In `plnd_api/src/routes/search.rs::search_ingredients_handler`, replace the streaming loop:

```rust
    let mut stream = state.provider_search.search_ingredients(sq);
    let mut resp = IngredientSearchResponse {
        local,
        ..Default::default()
    };
    while let Some(ev) = stream.next().await {
        match ev {
            ProviderSearchEvent::Results { results, .. } => resp.external.extend(results),
            ProviderSearchEvent::Done {
                providers_queried,
                providers_from_cache,
            } => {
                resp.providers_queried = providers_queried;
                resp.providers_from_cache = providers_from_cache;
            }
            ProviderSearchEvent::Error { .. } => {}
        }
    }
    Ok(Json(resp))
```

with:

```rust
    let mut stream = state.provider_search.search_ingredients(sq);
    let mut resp = IngredientSearchResponse {
        local,
        ..Default::default()
    };
    // Canonical-source (clean generic name) results lead; branded sources follow.
    let mut canonical_external: Vec<SearchResult> = Vec::new();
    let mut branded_external: Vec<SearchResult> = Vec::new();
    while let Some(ev) = stream.next().await {
        match ev {
            ProviderSearchEvent::Results {
                source, results, ..
            } => {
                if state.provider_search.is_canonical_source(&source) {
                    canonical_external.extend(results);
                } else {
                    branded_external.extend(results);
                }
            }
            ProviderSearchEvent::Done {
                providers_queried,
                providers_from_cache,
            } => {
                resp.providers_queried = providers_queried;
                resp.providers_from_cache = providers_from_cache;
            }
            ProviderSearchEvent::Error { .. } => {}
        }
    }
    canonical_external.append(&mut branded_external);
    resp.external = canonical_external;
    Ok(Json(resp))
```

`SearchResult` is already imported at the top of this file; no new import needed.

- [ ] **Step 2: Verify, then commit**

Run: `just verify`
Expected: PASS. (If an existing search integration test in `plnd_api/tests/search_test.rs` asserts a specific external ordering, update it to expect canonical-first; note any change in the commit.)

```bash
git add plnd_api/src/routes/search.rs
git commit -m "feat(search): surface canonical-source ingredients ahead of branded"
```

---

## Task 7: Refresh fixtures and reconcile fixture-dependent tests

**Files:**
- Modify: `plnd_data/fixtures/nutrition/usda_fdc/search.json`, `.../lookup.json` (regenerated)
- Modify: any test that asserts on now-removed branded fixture names (discovered by running `just verify`)

The fixture provider replays captured data; it does not re-run the new `dataType` filter. So the captured USDA fixtures must be regenerated against the now-filtered live provider for e2e/dev catalogs to be canonical.

- [ ] **Step 1: Refresh fixtures from live upstreams**

This requires `APP_EXTERNAL__USDA_FDC_API_KEY` via Doppler and network access. If you cannot run it, ask the user to run it in-session:

Suggest to the user: `! just refresh-fixtures`

Otherwise run: `just refresh-fixtures`
Expected: `plnd_data/fixtures/nutrition/usda_fdc/{search,lookup}.json` regenerated.

- [ ] **Step 2: Sanity-check the captured USDA names are canonical**

Run: `git diff --stat plnd_data/fixtures/nutrition/usda_fdc/`
Inspect a few entries: `git --no-pager diff plnd_data/fixtures/nutrition/usda_fdc/search.json | head -60`
Expected: USDA search entries now carry clean generic names (e.g. "Cheese, cheddar"), not branded composites. (OFF fixtures are unchanged — OFF remains the branded lane.)

- [ ] **Step 3: Run the full gate and reconcile any fixture-coupled assertions**

Run: `just verify`
Expected: PASS. If e2e specs (e.g. `plnd_client/e2e/**`) or integration tests (`plnd_api/tests/catalog_library_test.rs`, `plnd_api/tests/search_test.rs`) assert on specific ingredient names that the refresh removed, update those assertions to the new canonical names. Re-run `just verify` until green.

- [ ] **Step 4: Commit**

```bash
git add plnd_data/fixtures/nutrition/usda_fdc/ plnd_api/tests plnd_client/e2e
git commit -m "test(catalog): refresh USDA fixtures to canonical entries; reconcile tests"
```

---

## Task 8: Final review and PR

- [ ] **Step 1: Re-read the spec against the diff**

Confirm every spec section maps to a change: trait marker (Task 1), USDA dataType filter (Task 2), canonical-only seed (Task 3), fixture canonical-ness (Task 4), service lookup (Task 5), live ordering (Task 6), fixture refresh (Task 7).

- [ ] **Step 2: Run the code reviewer before pushing**

Invoke the code review skill / subagent on the branch diff (per CLAUDE.md: review BEFORE opening the PR, not after).

- [ ] **Step 3: Final verify, rebase, push, PR**

```bash
just verify
git fetch origin && git rebase origin/main
git push --force-with-lease -u origin feat/canonical-ingredient-catalog
gh pr create --fill --base main
```

The PR body should reference: `Closes #906` and note the follow-up `#913` for LLM normalization. After opening, invoke the `monitor-pr` skill.

---

## Self-review notes (author)

- **Spec coverage:** All eight spec component changes are covered by Tasks 1–7; PR/closeout in Task 8. ✅
- **No backfill / no migration:** confirmed — no schema or data-migration task exists (project has no persistent DB). ✅
- **Type/name consistency:** `is_canonical_source()` is used identically on the trait (Task 1), USDA impl (Task 1), fixture impl (Task 4), and the service lookup (Task 5). `is_canonical_data_type()` is USDA-internal (Task 2). The `canonical(bool)` builder (Task 4) and the `canonical` struct field are consistent. ✅
- **Constructors verified against the codebase:** `SearchCache::new(36)` and the `crate::providers::{UsdaFdcProvider, OpenFoodFactsProvider}` re-exports match existing usage in `search/mod.rs`. `async-trait = "0.1"` matches the version in `plnd_data`/`plnd_api`. ✅
