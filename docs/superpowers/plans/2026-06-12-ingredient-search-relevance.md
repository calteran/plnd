# Ingredient Search Relevance & External Surfacing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the onboarding ingredient search return recognizable, relevant ingredients (not branded composites) and surface/promote live provider results, resolving issue #858.

**Architecture:** Backend gains a `fetch_ingredient_detail` method on `ProviderSearchService` and a `POST /catalog/ingredients/promote` endpoint that fetches a chosen external result's full detail and ingests it into `catalog_ingredients` (mirroring #904's meal promotion). `search_ingredients` SQL is re-ranked to favor exact/prefix/short clean names. The onboarding component consumes `resp.external` and promotes-on-select. Seed terms are widened, with a hand-authored "cheese" fixture for deterministic e2e.

**Tech Stack:** Rust (Axum, sqlx, PostgreSQL FTS), Angular (signals, RxJS, Jasmine), Playwright e2e.

**Working directory:** `.worktrees/fix/858-ingredient-search-relevance` (branch `fix/858-ingredient-search-relevance`). Run all `git` commands with `git -C <worktree>` and all Angular commands from `<worktree>/plnd_client`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `plnd_data/src/search/mod.rs` | Provider orchestration | Add `fetch_ingredient_detail(source, external_id)` |
| `plnd_data/src/db/search.rs` | Catalog FTS queries | Re-rank `search_ingredients` |
| `plnd_api/src/routes/catalog_ingest.rs` | Catalog write endpoints | Add `PromoteIngredientBody`, `ingest_input_from_detail`, `promote_ingredient` handler |
| `plnd_api/src/main.rs` | Route registration | Register `POST /catalog/ingredients/promote` |
| `plnd_api/src/openapi.rs` | OpenAPI surface | Register the promote path + body schema |
| `plnd_seed/src/ingredients.rs` | Catalog seed terms | Widen `INGREDIENT_TERMS` |
| `plnd_data/fixtures/nutrition/usda_fdc/search.json` | e2e search fixture | Add `"cheese"` key |
| `plnd_data/fixtures/nutrition/usda_fdc/lookup.json` | e2e detail fixture | Add cheese detail entries |
| `plnd_client/src/app/core/services/catalog.service.ts` | API client | Type external results; add `promoteIngredient` |
| `plnd_client/.../dietary-preferences-substep.ts` | Onboarding ratings UI | Merge local+external; promote-on-select; badge |
| `plnd_client/.../dietary-preferences-substep.spec.ts` | Component tests | New external/promote tests |
| `plnd_client/e2e/...` | e2e | Cheese acceptance test |

---

## Task 1: Backend — `fetch_ingredient_detail` on `ProviderSearchService`

**Files:**
- Modify: `plnd_data/src/search/mod.rs` (add method to `impl ProviderSearchService`, after `resolve_ingredient` ~line 340; add tests in the existing `resolve_tests` module)

- [ ] **Step 1: Write the failing test**

Add to the `resolve_tests` module at the bottom of `plnd_data/src/search/mod.rs` (the `FakeNutrition` provider already defined there has `source_name() == "usda_fdc"` and returns ingredient id `"i1"` from `get_ingredient_by_id`):

```rust
    #[tokio::test]
    async fn fetch_ingredient_detail_returns_detail_for_matching_source() {
        let svc = ProviderSearchService::new(
            vec![Arc::new(FakeNutrition)],
            vec![],
            vec![],
            SearchCache::new(36),
        );
        let detail = svc
            .fetch_ingredient_detail("usda_fdc", "i1")
            .await
            .expect("expected detail for known id");
        assert_eq!(detail.name, "Tomato");
        assert_eq!(detail.external_id, "i1");
    }

    #[tokio::test]
    async fn fetch_ingredient_detail_returns_none_for_unknown_source() {
        let svc = ProviderSearchService::new(
            vec![Arc::new(FakeNutrition)],
            vec![],
            vec![],
            SearchCache::new(36),
        );
        assert!(svc.fetch_ingredient_detail("not_a_source", "i1").await.is_none());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p plnd_data search::resolve_tests::fetch_ingredient_detail`
Expected: FAIL — `no method named fetch_ingredient_detail`.

- [ ] **Step 3: Write minimal implementation**

Add this method to `impl ProviderSearchService` (immediately after `resolve_ingredient`):

```rust
    /// Fetch the full detail for a specific external ingredient by `(source, external_id)`.
    /// Used by the promote-on-select flow: the caller already holds the exact id the
    /// user picked, so this fetches that id directly rather than re-running a search.
    /// Returns `None` if no provider matches `source` or the provider has no such id.
    pub async fn fetch_ingredient_detail(
        &self,
        source: &str,
        external_id: &str,
    ) -> Option<ExternalIngredient> {
        let provider = self
            .nutrition_providers
            .iter()
            .find(|p| p.source_name() == source)?;
        provider.get_ingredient_by_id(external_id).await.ok().flatten()
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p plnd_data search::resolve_tests::fetch_ingredient_detail`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/fix/858-ingredient-search-relevance add plnd_data/src/search/mod.rs
git -C .worktrees/fix/858-ingredient-search-relevance commit -m "feat(search): add fetch_ingredient_detail for promote-on-select (#858)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend — rank clean/exact names in `search_ingredients`

**Files:**
- Modify: `plnd_data/src/db/search.rs` (`search_ingredients`, the `ORDER BY` clause ~lines 29-34; add a test to the existing `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `plnd_data/src/db/search.rs`:

```rust
    #[sqlx::test(migrations = "./migrations")]
    async fn search_ingredients_ranks_clean_name_above_branded(pool: PgPool) {
        sqlx::query(
            "INSERT INTO catalog_ingredients (name, description, allergens, occasion_tags) VALUES \
             ('ALFREDO BROCCOLI Fettuccine & Broccoli in a Parmesan & Romano Cheese Sauce', \
              'frozen dinner', '{}', '{}'), \
             ('Cheese, cheddar', 'dairy', '{}', '{}')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let results = search_ingredients(&pool, "cheese", 10, &[], None)
            .await
            .unwrap();

        assert!(results.len() >= 2, "both rows should match the FTS predicate");
        assert_eq!(
            results[0].name, "Cheese, cheddar",
            "clean prefix/short name must outrank the long branded composite"
        );
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p plnd_data db::search::tests::search_ingredients_ranks_clean_name_above_branded`
Expected: FAIL — currently the branded row may rank first (flat `ts_rank`).

- [ ] **Step 3: Write minimal implementation**

In `search_ingredients`, replace the existing `ORDER BY` block:

```sql
        ORDER BY ts_rank(
            to_tsvector('english', name || ' ' || COALESCE(description, '')),
            plainto_tsquery('english', $1)
        ) DESC
        LIMIT $2
```

with the tiered ordering:

```sql
        ORDER BY
          (CASE
             WHEN lower(name) = lower($1)           THEN 3
             WHEN lower(name) LIKE lower($1) || '%'  THEN 2
             ELSE 0
           END) DESC,
          ts_rank(
            to_tsvector('english', name || ' ' || COALESCE(description, '')),
            plainto_tsquery('english', $1)
          ) DESC,
          length(name) ASC
        LIMIT $2
```

Leave the `WHERE` clause and all bindings unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p plnd_data db::search::tests::search_ingredients_ranks_clean_name_above_branded`
Expected: PASS. Also run the existing module to confirm no regression:
Run: `cargo test -p plnd_data db::search::tests`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/fix/858-ingredient-search-relevance add plnd_data/src/db/search.rs
git -C .worktrees/fix/858-ingredient-search-relevance commit -m "feat(search): rank exact/prefix/short ingredient names above branded composites (#858)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Backend — promote endpoint

**Files:**
- Modify: `plnd_api/src/routes/catalog_ingest.rs` (add body type, pure mapping helper + its test, handler)
- Modify: `plnd_api/src/main.rs` (register route ~line 311-318, next to the existing ingest route)
- Modify: `plnd_api/src/openapi.rs` (register path ~line 93 and schema)

- [ ] **Step 1: Write the failing test (pure mapping helper)**

Add to the `#[cfg(test)] mod tests` in `plnd_api/src/routes/catalog_ingest.rs`:

```rust
    #[test]
    fn ingest_input_from_detail_maps_nutrition_and_ids() {
        use plnd_data::providers::dtos::ExternalIngredient;
        let detail = ExternalIngredient {
            external_id: "173945".into(),
            name: "Bananas, dehydrated, or banana powder".into(),
            serving_size_g: None,
            nutrition: None,
            allergens: vec!["none".into()],
            occasion_tags: vec![],
        };
        let input = ingest_input_from_detail("usda_fdc", detail);
        assert_eq!(input.external_source, "usda_fdc");
        assert_eq!(input.external_id, "173945");
        assert_eq!(input.name, "Bananas, dehydrated, or banana powder");
        assert_eq!(input.allergens, vec!["none".to_string()]);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p plnd_api routes::catalog_ingest::tests::ingest_input_from_detail`
Expected: FAIL — `cannot find function ingest_input_from_detail`.

- [ ] **Step 3: Write minimal implementation (helper + body + handler)**

At the top of `plnd_api/src/routes/catalog_ingest.rs`, add imports alongside the existing ones:

```rust
use crate::routes::search::IngredientSearchResponse; // not needed; remove if unused
```
(If `IngredientSearchResponse` import is unnecessary for compilation, omit it — only add imports actually used below.)

Add the pure helper (module-level, after the response structs):

```rust
/// Map a provider's full ingredient detail into the catalog ingest input.
/// Nutrition is serialized to JSON; a serialization failure degrades to `None`
/// rather than failing the whole promotion.
pub(crate) fn ingest_input_from_detail(
    external_source: &str,
    detail: plnd_data::providers::dtos::ExternalIngredient,
) -> IngestIngredientInput {
    IngestIngredientInput {
        external_source: external_source.to_string(),
        external_id: detail.external_id,
        name: detail.name,
        description: None,
        serving_size_g: detail.serving_size_g,
        nutrition: detail
            .nutrition
            .as_ref()
            .and_then(|n| serde_json::to_value(n).ok()),
        allergens: detail.allergens,
        occasion_tags: detail.occasion_tags,
    }
}
```

Add the request body type (next to `IngestIngredientBody`):

```rust
#[derive(Deserialize, utoipa::ToSchema)]
pub struct PromoteIngredientBody {
    pub external_source: String,
    pub external_id: String,
}
```

Add the handler (reuses `IngestIngredientResponse`):

```rust
#[utoipa::path(
    post,
    path = "/catalog/ingredients/promote",
    tag = "Catalog",
    request_body = PromoteIngredientBody,
    security(("bearer_auth" = [])),
    responses(
        (status = 201, description = "External ingredient promoted into catalog", body = IngestIngredientResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "No provider matched source, or external id not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(external_source = %body.external_source, external_id = %body.external_id))]
pub async fn promote_ingredient(
    State(state): State<Arc<AppState>>,
    Extension(_claims): Extension<Claims>,
    Json(body): Json<PromoteIngredientBody>,
) -> Result<(StatusCode, Json<IngestIngredientResponse>), StatusCode> {
    let detail = state
        .provider_search
        .fetch_ingredient_detail(&body.external_source, &body.external_id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;
    let id = state
        .repos
        .catalog_ingest
        .ingest_ingredient(ingest_input_from_detail(&body.external_source, detail))
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "promote_ingredient ingest error");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok((
        StatusCode::CREATED,
        Json(IngestIngredientResponse { ingredient_id: id }),
    ))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p plnd_api routes::catalog_ingest::tests::ingest_input_from_detail`
Expected: PASS.

- [ ] **Step 5: Register the route**

In `plnd_api/src/main.rs`, directly after the existing block:

```rust
        .route(
            "/catalog/ingredients/ingest",
            post(catalog_ingest::ingest_ingredient),
        )
```

add:

```rust
        .route(
            "/catalog/ingredients/promote",
            post(catalog_ingest::promote_ingredient),
        )
```

- [ ] **Step 6: Register in OpenAPI**

In `plnd_api/src/openapi.rs`, add to the `paths(...)` list after `crate::routes::catalog_ingest::ingest_ingredient,`:

```rust
        crate::routes::catalog_ingest::promote_ingredient,
```

and add `PromoteIngredientBody` to the `components(schemas(...))` block alongside `IngestIngredientBody` (search for `IngestIngredientBody` in the schemas list and add `crate::routes::catalog_ingest::PromoteIngredientBody,` next to it).

- [ ] **Step 7: Verify compile**

Run: `just verify-build`
Expected: clean compile, no warnings about unused imports (remove the placeholder `IngredientSearchResponse` import if added).

- [ ] **Step 8: Commit**

```bash
git -C .worktrees/fix/858-ingredient-search-relevance add plnd_api/src/routes/catalog_ingest.rs plnd_api/src/main.rs plnd_api/src/openapi.rs
git -C .worktrees/fix/858-ingredient-search-relevance commit -m "feat(catalog): add POST /catalog/ingredients/promote endpoint (#858)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — catalog service types + `promoteIngredient`

**Files:**
- Modify: `plnd_client/src/app/core/services/catalog.service.ts`
- Test: `plnd_client/src/app/core/services/catalog.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `catalog.service.spec.ts` (it uses `provideHttpClient`/`provideHttpClientTesting` + `HttpTestingController` — match the existing setup in that file):

```typescript
  it('promoteIngredient POSTs source+id and returns ingredient_id', () => {
    let result: { ingredient_id: string } | undefined;
    service.promoteIngredient({ external_source: 'usda_fdc', external_id: '173945' })
      .subscribe(r => (result = r));

    const req = httpMock.expectOne(r => r.url.endsWith('/catalog/ingredients/promote'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ external_source: 'usda_fdc', external_id: '173945' });
    req.flush({ ingredient_id: 'ing-99' });

    expect(result).toEqual({ ingredient_id: 'ing-99' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `plnd_client/`): `npx ng test --watch=false --include='**/catalog.service.spec.ts'`
Expected: FAIL — `promoteIngredient` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `catalog.service.ts`, replace `external: unknown[];` in `IngredientSearchResponse` with a typed array and add the supporting interfaces + method:

```typescript
export interface ExternalIngredientResult {
  external_id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
}

export interface PromoteIngredientBody {
  external_source: string;
  external_id: string;
}
```

Update the response interface:

```typescript
export interface IngredientSearchResponse {
  local: LocalIngredientResult[];
  external: ExternalIngredientResult[];
  providers_queried: string[];
  providers_from_cache: string[];
}
```

Add the method to `CatalogService` (after `ingestIngredient`):

```typescript
  promoteIngredient(body: PromoteIngredientBody): Observable<IngestIngredientResponse> {
    return this.http.post<IngestIngredientResponse>(
      `${this.apiBase}/catalog/ingredients/promote`,
      body
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `plnd_client/`): `npx ng test --watch=false --include='**/catalog.service.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/fix/858-ingredient-search-relevance add plnd_client/src/app/core/services/catalog.service.ts plnd_client/src/app/core/services/catalog.service.spec.ts
git -C .worktrees/fix/858-ingredient-search-relevance commit -m "feat(catalog-client): type external results and add promoteIngredient (#858)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — surface + promote external results in onboarding

**Files:**
- Modify: `plnd_client/.../dietary-preferences-substep/dietary-preferences-substep.ts`
- Test: `plnd_client/.../dietary-preferences-substep/dietary-preferences-substep.spec.ts`

**Design:** the dropdown signal becomes a union row type. Local rows keep `ingredient_id`; external rows carry `external_source`/`external_id` and render a source badge. Selecting an external row calls `promoteIngredient` → on success sets `pendingIngredientId` to the returned id and continues exactly as a local selection; on error falls back to free-text via the existing path.

- [ ] **Step 1: Write the failing tests**

First extend the `CatalogService` spy in the `beforeEach` of `dietary-preferences-substep.spec.ts` so it knows the new method:

```typescript
    catalogSvc = jasmine.createSpyObj('CatalogService', ['searchIngredients', 'promoteIngredient']);
    catalogSvc.searchIngredients.and.returnValue(
      of({ local: [], external: [], providers_queried: [], providers_from_cache: [] })
    );
    catalogSvc.promoteIngredient.and.returnValue(of({ ingredient_id: 'promoted-1' }));
```

Then add tests:

```typescript
  it('merges external results into the dropdown after local ones', fakeAsync(() => {
    catalogSvc.searchIngredients.and.returnValue(of({
      local: [{ ingredient_id: 'loc-1', name: 'Cheese, cheddar', description: null, allergens: [], occasion_tags: [], external_source: null }],
      external: [{ external_id: '99', name: 'Cheese, mozzarella', description: null, thumbnail_url: null }],
      providers_queried: ['usda_fdc'], providers_from_cache: [],
    }));
    component.onIngredientInput('cheese');
    tick(400); // debounce
    flush();
    const rows = component.ingredientSearchResults();
    expect(rows.length).toBe(2);
    expect(rows[0].kind).toBe('local');
    expect(rows[1].kind).toBe('external');
  }));

  it('selecting an external result promotes it then sets the catalog id', fakeAsync(() => {
    component.selectIngredientResult({ kind: 'external', external_source: 'usda_fdc', external_id: '99', name: 'Cheese, mozzarella', allergens: [] });
    flush();
    expect(catalogSvc.promoteIngredient).toHaveBeenCalledWith({ external_source: 'usda_fdc', external_id: '99' });
    expect(component.pendingIngredientId()).toBe('promoted-1');
    expect(component.ingredientInput()).toBe('Cheese, mozzarella');
  }));
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `plnd_client/`): `npx ng test --watch=false --include='**/dietary-preferences-substep.spec.ts'`
Expected: FAIL — `kind` property does not exist / `selectIngredientResult` signature mismatch.

- [ ] **Step 3: Write minimal implementation**

In `dietary-preferences-substep.ts`:

(a) Add the union row type near `IngredientRating` (top of file) and import `ExternalIngredientResult`:

```typescript
import { CatalogService, IngredientSearchResponse, LocalIngredientResult, ExternalIngredientResult } from '../../../../../core/services/catalog.service';
```

```typescript
type IngredientSearchRow =
  | { kind: 'local'; ingredient_id: string; name: string; allergens: string[] }
  | { kind: 'external'; external_source: string; external_id: string; name: string; allergens: string[] };
```

(b) Change the signal type (line ~282):

```typescript
  readonly ingredientSearchResults = signal<IngredientSearchRow[]>([]);
```

(c) Update the search subscription (the `.subscribe(resp => this.ingredientSearchResults.set(resp.local))` around line 328) to merge and dedup:

```typescript
    ).subscribe((resp: IngredientSearchResponse) => {
      const localRows: IngredientSearchRow[] = resp.local.map(r => ({
        kind: 'local', ingredient_id: r.ingredient_id, name: r.name, allergens: r.allergens,
      }));
      const localNames = new Set(resp.local.map(r => r.name.toLowerCase()));
      const externalRows: IngredientSearchRow[] = resp.external
        .filter((r: ExternalIngredientResult) => !localNames.has(r.name.toLowerCase()))
        .map((r: ExternalIngredientResult) => ({
          kind: 'external', external_source: 'usda_fdc', external_id: r.external_id, name: r.name, allergens: [],
        }));
      this.ingredientSearchResults.set([...localRows, ...externalRows]);
    });
```

> Note: `ExternalIngredientResult` from `/search/ingredients` does not carry its provider source (the response groups all providers into one `external` array). Promotion needs a source; `usda_fdc` is the only nutrition provider whose detail-by-id is used here, and the promote endpoint returns 404 for a mismatch (harmlessly falling back to free-text). If a second nutrition provider is added later, extend the search response to tag each external row with its source. Tracked by the broader provider work; acceptable for #858.

(d) Replace `selectIngredientResult` to accept the union and promote externals:

```typescript
  selectIngredientResult(result: IngredientSearchRow): void {
    this.ingredientInput.set(result.name);
    this.ingredientSearchResults.set([]);
    if (result.kind === 'local') {
      this.pendingIngredientId.set(result.ingredient_id);
      return;
    }
    // External: promote into the catalog to obtain a real ingredient id.
    this.catalogService
      .promoteIngredient({ external_source: result.external_source, external_id: result.external_id })
      .subscribe({
        next: r => this.pendingIngredientId.set(r.ingredient_id),
        error: () => this.pendingIngredientId.set(null), // fall back to free-text entry
      });
  }
```

(e) Update the template dropdown block (lines ~137-148): change the `track` key and render a source badge:

```html
            @if (ingredientSearchResults().length) {
              <div class="search-dropdown">
                @for (r of ingredientSearchResults(); track r.name) {
                  <button type="button" class="search-result" (mousedown)="$event.preventDefault()" (click)="selectIngredientResult(r)">
                    <span class="result-name">
                      {{ r.name }}
                      @if (r.kind === 'external') {
                        <span class="result-source">{{ r.external_source === 'usda_fdc' ? 'USDA' : 'Open Food Facts' }}</span>
                      }
                    </span>
                    @if (r.allergens.length) {
                      <span class="result-allergens">{{ r.allergens.join(', ') }}</span>
                    }
                  </button>
                }
              </div>
            }
```

(f) Add a style for `.result-source` in the component `styles` array (near `.result-allergens`):

```css
    .result-source { margin-left: 6px; font-size: 0.7rem; color: var(--color-text-muted); border: 1px solid var(--color-border-row); border-radius: 4px; padding: 0 4px; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `plnd_client/`): `npx ng test --watch=false --include='**/dietary-preferences-substep.spec.ts'`
Expected: PASS (new tests + existing ones in the file).

- [ ] **Step 5: Commit**

```bash
git -C .worktrees/fix/858-ingredient-search-relevance add plnd_client/src/app/features/onboarding/food/substeps/dietary-preferences-substep/
git -C .worktrees/fix/858-ingredient-search-relevance commit -m "feat(onboarding): surface and promote external ingredient results (#858)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Seed widening + hand-authored cheese fixture

**Files:**
- Modify: `plnd_seed/src/ingredients.rs` (`INGREDIENT_TERMS`)
- Modify: `plnd_data/fixtures/nutrition/usda_fdc/search.json`
- Modify: `plnd_data/fixtures/nutrition/usda_fdc/lookup.json`

- [ ] **Step 1: Write the failing test**

Add to `plnd_seed/src/ingredients.rs` (add a `#[cfg(test)] mod tests` if none exists):

```rust
#[cfg(test)]
mod tests {
    use super::INGREDIENT_TERMS;

    #[test]
    fn seed_terms_include_common_ingredients_and_are_deduped() {
        assert!(INGREDIENT_TERMS.contains(&"cheese"), "cheese must be seeded (the #858 example)");
        assert!(INGREDIENT_TERMS.len() >= 30, "seed list should be meaningfully widened");
        let mut sorted = INGREDIENT_TERMS.to_vec();
        sorted.sort_unstable();
        let before = sorted.len();
        sorted.dedup();
        assert_eq!(before, sorted.len(), "seed terms must be unique");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p plnd_seed ingredients::tests::seed_terms_include_common`
Expected: FAIL — `cheese` not present / length < 30.

- [ ] **Step 3: Widen the seed list**

Replace `INGREDIENT_TERMS` in `plnd_seed/src/ingredients.rs` with a curated list (keep the existing 8, add ~32 more; all unique, lowercased):

```rust
pub const INGREDIENT_TERMS: &[&str] = &[
    "oats", "banana", "chicken breast", "brown rice", "broccoli", "milk", "egg", "olive oil",
    "cheese", "chicken", "beef", "pork", "salmon", "tuna", "shrimp", "tofu",
    "rice", "pasta", "bread", "butter", "yogurt", "spinach", "tomato", "onion",
    "garlic", "potato", "sweet potato", "carrot", "apple", "orange", "strawberry", "blueberry",
    "almond", "peanut butter", "black beans", "lentils", "avocado", "corn", "lettuce", "mushroom",
];
```

- [ ] **Step 4: Add the cheese search fixture**

In `plnd_data/fixtures/nutrition/usda_fdc/search.json`, add a `"cheese"` key (sibling of `"oats"` etc.). Match the existing object shape exactly:

```json
  "cheese": [
    { "external_id": "328637", "name": "Cheese, cheddar", "description": "Dairy and Egg Products", "thumbnail_url": null },
    { "external_id": "328649", "name": "Cheese, mozzarella, whole milk", "description": "Dairy and Egg Products", "thumbnail_url": null }
  ]
```

- [ ] **Step 5: Add the cheese lookup fixtures**

In `plnd_data/fixtures/nutrition/usda_fdc/lookup.json`, add two entries (match the `serving_size_g` string + full `nutrition` key set used by existing entries; unknown micronutrients are `null`):

```json
  "328637": {
    "external_id": "328637",
    "name": "Cheese, cheddar",
    "serving_size_g": "100",
    "nutrition": {
      "calories_kcal": 403.0, "protein_g": 24.9, "carbohydrates_g": 3.4, "fat_g": 33.1,
      "fiber_g": null, "sugar_g": 0.5, "sodium_mg": 653.0, "potassium_mg": null,
      "calcium_mg": 710.0, "iron_mg": null, "vitamin_c_mg": null, "vitamin_d_iu": null,
      "saturated_fat_g": 18.9, "cholesterol_mg": 99.0
    },
    "allergens": ["milk"],
    "occasion_tags": []
  },
  "328649": {
    "external_id": "328649",
    "name": "Cheese, mozzarella, whole milk",
    "serving_size_g": "100",
    "nutrition": {
      "calories_kcal": 300.0, "protein_g": 22.2, "carbohydrates_g": 2.2, "fat_g": 22.4,
      "fiber_g": null, "sugar_g": 1.0, "sodium_mg": 627.0, "potassium_mg": null,
      "calcium_mg": 505.0, "iron_mg": null, "vitamin_c_mg": null, "vitamin_d_iu": null,
      "saturated_fat_g": 13.2, "cholesterol_mg": 79.0
    },
    "allergens": ["milk"],
    "occasion_tags": []
  }
```

> Verify the exact `nutrition` field set first by reading one existing entry in `lookup.json` (e.g. id `1905976`) and match its keys precisely — `serde` will reject unknown/missing fields against `NutritionFacts`. Adjust the JSON above to match if the field set differs.

- [ ] **Step 6: Run test + validate fixtures parse**

Run: `cargo test -p plnd_seed ingredients::tests::seed_terms_include_common`
Expected: PASS.
Run: `cargo test -p plnd_data providers::nutrition_fixture`
Expected: PASS (confirms the fixture files still deserialize).

- [ ] **Step 7: Commit**

```bash
git -C .worktrees/fix/858-ingredient-search-relevance add plnd_seed/src/ingredients.rs plnd_data/fixtures/nutrition/usda_fdc/search.json plnd_data/fixtures/nutrition/usda_fdc/lookup.json
git -C .worktrees/fix/858-ingredient-search-relevance commit -m "feat(seed): widen ingredient seed terms and add cheese fixture (#858)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: E2E — cheese acceptance test

**Files:**
- Locate the onboarding food/dietary e2e spec under `plnd_client/e2e/` (search for `dietary` or `Ingredient`). If a relevant spec exists, add a test there; otherwise create `plnd_client/e2e/onboarding-ingredient-search.spec.ts` following the structure of a nearby onboarding spec (use `seedAuth(page)` / `seedOnboarding(page)` from `e2e/helpers/auth.ts`, per CLAUDE.md — never hardcode a token).

- [ ] **Step 1: Inspect an existing onboarding e2e for the navigation + selectors**

Run: `ls plnd_client/e2e && grep -rl "dietary\|ingredient\|Ingredient Ratings\|search ingredient" plnd_client/e2e`
Read the closest match to learn how the test navigates into the food/dietary substep and what selectors it uses.

- [ ] **Step 2: Write the e2e test**

Add a test that: seeds auth + onboarding, navigates to the dietary-preferences substep, types "cheese" into the ingredient search input (`placeholder="Search ingredient…"`), waits for the `.search-dropdown`, and asserts a recognizable result containing "Cheese" appears, then clicks it and confirms it is added to the ratings list. Concrete skeleton (adapt selectors to the navigation helper found in Step 1):

```typescript
import { test, expect } from '@playwright/test';
import { seedAuth, seedOnboarding } from './helpers/auth';

test('onboarding ingredient search returns a recognizable cheese result', async ({ page }) => {
  await seedAuth(page);
  await seedOnboarding(page);
  // ...navigate to the dietary-preferences substep (reuse the pattern from the spec found in Step 1)...

  const search = page.getByPlaceholder('Search ingredient…');
  await search.fill('cheese');

  const dropdown = page.locator('.search-dropdown');
  await expect(dropdown).toBeVisible();
  const cheeseResult = dropdown.locator('.search-result', { hasText: /Cheese/i }).first();
  await expect(cheeseResult).toBeVisible();
  await cheeseResult.click();

  await expect(search).toHaveValue(/Cheese/i);
});
```

- [ ] **Step 3: Run the e2e**

The full `just verify` (Task 8) runs e2e with the API up and `APP_EXTERNAL__FIXTURE_PATH` set. For a faster standalone loop while iterating, start the stack with `just dev` (background) and run:
Run (from `plnd_client/`): `npx playwright test e2e/onboarding-ingredient-search.spec.ts`
Expected: PASS — "Cheese, cheddar" (seeded from the new fixture) appears and is selectable.

> If the dropdown is empty, the seeder did not pick up "cheese": confirm `cheese` is in `INGREDIENT_TERMS` (Task 6) and that the `"cheese"` key exists in `search.json` with matching `lookup.json` ids, then restart the API so the startup seeder re-runs.

- [ ] **Step 4: Commit**

```bash
git -C .worktrees/fix/858-ingredient-search-relevance add plnd_client/e2e/
git -C .worktrees/fix/858-ingredient-search-relevance commit -m "test(e2e): onboarding ingredient search returns recognizable cheese result (#858)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full verification, review, and PR

- [ ] **Step 1: Rebase onto origin/main**

```bash
git -C .worktrees/fix/858-ingredient-search-relevance fetch origin
git -C .worktrees/fix/858-ingredient-search-relevance rebase origin/main
```

- [ ] **Step 2: Run the full gate**

Run: `just verify`
Expected: all green (quality + build + unit + e2e). Fix any failure before proceeding — no failing test is acceptable.

- [ ] **Step 3: Code review before PR**

Invoke the code-review subagent (per repo convention: review before opening the PR, not after). Address findings.

- [ ] **Step 4: Push and open the PR**

```bash
git -C .worktrees/fix/858-ingredient-search-relevance push -u origin fix/858-ingredient-search-relevance
```

Open the PR with `gh pr create`. Body must include `Closes #858` and a "Follow-up: #906 (canonical catalog)" line, plus a summary of A/B/C and the hand-authored-fixture note.

- [ ] **Step 5: Monitor CI**

Invoke the `monitor-pr` skill to watch CI and address review comments.

---

## Self-Review Notes (author)

- **Spec coverage:** A → Tasks 1,3,4,5; B → Task 2; C → Task 6; external surfacing (#4) → Tasks 4,5; testing strategy → Tasks 1-7; D deferral → referenced (PR body links #906). All spec sections covered.
- **Deviation from spec:** spec's Task C suggested `just refresh-fixtures` (needs Doppler). This plan hand-authors a minimal "cheese" fixture instead — deterministic, offline, same fixture format. `refresh-fixtures` remains the path for real upstream re-capture. Flagged to the user.
- **Type consistency:** `IngredientSearchRow` union (`kind: 'local' | 'external'`), `promoteIngredient(PromoteIngredientBody) -> IngestIngredientResponse`, `fetch_ingredient_detail(&str,&str) -> Option<ExternalIngredient>`, `ingest_input_from_detail(&str, ExternalIngredient) -> IngestIngredientInput` — names consistent across backend Tasks 1/3 and frontend Tasks 4/5.
- **Open verification points for the implementer:** (1) exact `NutritionFacts` field set in `lookup.json` (Task 6 Step 5 note); (2) onboarding e2e navigation pattern (Task 7 Step 1); (3) `components(schemas(...))` list location in `openapi.rs` (Task 3 Step 6).
