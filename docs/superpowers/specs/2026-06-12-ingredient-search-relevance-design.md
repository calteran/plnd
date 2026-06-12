# Ingredient search relevance & external-result surfacing — design

**Issue:** [#858](https://github.com/calteran/plnd/issues/858) — "Ingredient search returns irrelevant branded products and discards external provider results"
**Date:** 2026-06-12
**Status:** Approved design, pending implementation

## Problem

Searching the onboarding **Ingredient Ratings** field for a common ingredient (e.g. "cheese")
surfaces irrelevant branded composites — or nothing useful. Issue #858 identifies four root
causes:

1. **Narrow seed coverage** — the startup catalog seeder (`INGREDIENT_TERMS`) ingests only 8
   fixed terms, so most common ingredients never exist locally.
2. **Branded composite names** — USDA FDC / Open Food Facts return long branded product names
   that land verbatim in `catalog_ingredients.name`.
3. **Flat ranking** — `search_ingredients` orders purely by `ts_rank`, so a short clean name
   ("Cheese, cheddar") does not beat a long branded one ("ALFREDO BROCCOLI … Cheese Sauce").
4. **Frontend discards external results** — `GET /search/ingredients` already returns both
   `local` and `external`, but the onboarding component consumes only `resp.local`, so live
   provider matches never surface.

## Scope & decomposition

This issue ships the **high-leverage core plus seed widening** (causes #1, #3, #4 and the
visible symptom of #2). The deeper data-model fix for cause #2 — a curated canonical ingredient
catalog distinct from branded provider data — is **deferred to a new sub-issue** because it is
an architectural decision with multiple viable shapes (canonical table vs. provider data-type
filtering vs. heuristic branded-name filter) that warrants its own brainstorm.

| Piece | Root cause | Status |
|-------|-----------|--------|
| A. Surface + promote external results | #4 (and "nothing useful") | This PR |
| B. Rank clean/exact names above branded composites | #3 (and visible #2) | This PR |
| C. Widen/curate seed terms | #1 | This PR |
| D. Curated canonical ingredient catalog | #2 (root) | New sub-issue |

**Acceptance criterion (from #858):** searching "cheese" (and similar common ingredients) in the
onboarding Ingredient Ratings field returns recognizable, relevant ingredient options.

## A. Surface + promote external results

### Constraint that shapes the design

A search hit (`SearchResult`) carries only `external_id`, `name`, `description`, `thumbnail_url`
— **no nutrition**. Nutrition is only available from the provider detail call
(`get_ingredient_by_id` → `ExternalIngredient`). The existing `POST /catalog/ingredients/ingest`
endpoint requires the *caller* to supply nutrition. Therefore the browser cannot ingest a
selected external result directly — the detail must be fetched server-side. This is the same
list-hit-vs-detail-record split that #904 bridged for meals (`routes/meal_promotion.rs`); we
mirror that pattern one resource over.

### Backend — new `POST /catalog/ingredients/promote`

Request body:

```json
{ "external_source": "usda_fdc", "external_id": "171705" }
```

Handler (`routes/catalog_ingest.rs`, alongside the existing ingest/contribute handlers):

1. Resolve the nutrition provider whose `source_name()` matches `external_source`.
2. Call `get_ingredient_by_id(external_id)` to fetch the full `ExternalIngredient`.
3. Map it to `IngestIngredientInput` (reusing the `ingredient_input_from`-style mapping already
   used in `meal_promotion.rs`) and call the existing `CatalogIngestRepository::ingest_ingredient`
   — idempotent via the `uq_ingredient_external` constraint.
4. Return `{ "ingredient_id": "<uuid>" }` (mirrors `IngestIngredientResponse`).

Outcomes:
- **201 Created** with `ingredient_id` on success (matches the existing ingest endpoint).
- **404** if the provider returns `None` (the external item no longer exists) or no provider
  matches `external_source`.
- **500** on provider/DB error.

The provider lookup uses the `ProviderSearchService` nutrition providers already held in
`AppState`. To match a single provider by name without a new trait method, the handler iterates
the nutrition providers and selects the one whose `source_name()` equals `external_source`.

> **Design note — why a dedicated promote endpoint rather than extending `resolve_ingredient`:**
> `resolve_ingredient` resolves by *name* (search → take top → detail). Here we already hold the
> exact `external_id` the user picked, so we fetch that id directly — more precise, and avoids
> re-running a search whose top hit might differ.

### Frontend — `dietary-preferences-substep.ts`

- The search subscription consumes **both** `resp.local` and `resp.external`. The dropdown shows
  local rows first (instant select), then external rows, de-duplicated against local by
  case-insensitive `name` match.
- External rows render a small source badge ("USDA" / "Open Food Facts") so the provenance is
  clear and they are visually distinguishable from already-cataloged rows.
- The dropdown model becomes a discriminated union: `{ kind: 'local', … }` carrying
  `ingredient_id`, or `{ kind: 'external', … }` carrying `external_source` + `external_id`.
- `selectIngredientResult`:
  - **local** → unchanged (sets `pendingIngredientId`).
  - **external** → call `catalogService.promoteIngredient({ external_source, external_id })`;
    on success set `pendingIngredientId` to the returned `ingredient_id`, then proceed through
    the existing pref-upsert path. On failure, fall through to the #855 free-text behavior and
    surface the existing save-error state.
- `catalog.service.ts` gains `promoteIngredient(body): Observable<IngestIngredientResponse>`
  hitting `/catalog/ingredients/promote`, plus the `external_source`/`external_id` types for
  external search results.

> The promotion happens **on select**, not on every keystroke — only ingredients a user actually
> picks enter the catalog. This both fixes the "nothing useful" symptom (live USDA/OFF matches
> now surface) and avoids the broad-seed pollution that caused branded composites to leak in as
> seed side-effects.

## B. Rank clean/exact names above branded composites

In `search_ingredients` (`plnd_data/src/db/search.rs`), replace the flat `ORDER BY ts_rank(...)`
with a tiered ordering:

```sql
ORDER BY
  (CASE
     WHEN lower(name) = lower($1)            THEN 3   -- exact name
     WHEN lower(name) LIKE lower($1) || '%'  THEN 2   -- prefix
     ELSE 0
   END) DESC,
  ts_rank(
    to_tsvector('english', name || ' ' || COALESCE(description, '')),
    plainto_tsquery('english', $1)
  ) DESC,
  length(name) ASC   -- shorter clean names break ties over long branded ones
LIMIT $2
```

This keeps the existing FTS `WHERE` predicate (so the candidate set is unchanged) and only
reorders, so it is low-risk. The `length(name)` tiebreak ensures "Cheese, cheddar" beats
"ALFREDO BROCCOLI … in a Parmesan & Romano Cheese Sauce" when both share the same FTS rank
bucket. Scoped to `search_ingredients` only for this issue; `search_dishes` /
`search_catalog_meals` / `search_exercises` are left unchanged.

## C. Widen/curate seed terms

Expand `INGREDIENT_TERMS` (`plnd_seed/src/ingredients.rs`) from 8 terms to a curated list of
~40 common single-word / simple ingredients (cheese, chicken, beef, pork, salmon, tuna, eggs,
rice, pasta, bread, butter, yogurt, spinach, tomato, onion, garlic, potato, carrot, apple,
banana, orange, almond, oats, milk, broccoli, olive oil, …). The list stays deliberately small
and generic — it is a cold-start aid, not a substitute for A.

### Fixture requirement (important)

The catalog seeder routes through **file-backed fixtures** under `debug_assertions` / e2e (see
CLAUDE.md and `reference_testing_agent_and_provider_integration`). New seed terms without
captured fixtures degrade gracefully — the seeder logs a `warn` and skips that term — but they
will not populate in tests. To prove the acceptance criterion end-to-end, fixtures for at least
**"cheese"** (the issue's own example) must be captured via `just refresh-fixtures` (requires
`APP_EXTERNAL__USDA_FDC_API_KEY` via Doppler). The implementation plan must confirm
`just refresh-fixtures` runs and that the new fixtures cover the term(s) exercised by the e2e
test before relying on local seeding; otherwise the e2e test must assert on the **external**
result path (which exercises A regardless of seed state).

## Testing

- **B (ranking)** — Rust unit test in `db/search.rs`: insert a clean `"Cheese, cheddar"` row and
  a branded `"ALFREDO BROCCOLI … Cheese Sauce"` row, assert the clean row ranks first for
  `search_ingredients(pool, "cheese", …)`.
- **A backend (promote)** — fixture-backed integration test for the promote endpoint/handler,
  mirroring the `promote_ingests_real_themealdb_fixture_recipe` pattern: a
  `FixtureNutritionProvider` resolves a known `external_id` and the handler ingests a catalog
  ingredient keyed to the real provider source/id. (Rust integration coverage is required
  because e2e mocks the browser layer — per
  `reference_testing_agent_and_provider_integration`.)
- **A frontend** — `dietary-preferences-substep.spec.ts`: external results render with a source
  badge; selecting an external result calls `promoteIngredient` then the pref upsert; promote
  failure falls back to free-text. Run from the worktree's `plnd_client/` with `npx ng test`.
- **E2E** — onboarding flow searches "cheese" and selects a returned result. Asserts a
  recognizable option appears (via local seed if "cheese" fixtures are captured, otherwise via
  the external path). Uses the real backend with `APP_EXTERNAL__FIXTURE_PATH`.
- **Full gate** — `just verify` before commit (quality + build + unit + e2e).

## Follow-up sub-issue (D)

Open against the catalog area: **"Curated canonical ingredient catalog distinct from branded
provider data."** Capture the three candidate approaches for its own brainstorm:

1. A curated canonical-ingredient table presented above/instead of branded provider rows.
2. Provider data-type filtering (prefer USDA *Foundation* / *SR Legacy* over *Branded*; prefer
   Open Food Facts generic over branded).
3. A heuristic branded-name filter / de-prioritization at ingest or query time.

Link it as a follow-up of #858. The work in this PR satisfies #858's acceptance criterion, so
#858 closes on merge and D proceeds independently.

## Out of scope

- Changes to dish/meal/exercise search ranking.
- Any change to the `/catalog/ingredients/ingest` or `/catalog/ingredients` (contribute)
  contracts beyond adding the new promote endpoint.
- The canonical-ingredient data model (piece D).
