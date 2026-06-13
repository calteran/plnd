# Canonical ingredient catalog via provider data-type filtering

**Issue:** #906 (follows up #858; builds on the lazy-promotion pattern from #904)
**Date:** 2026-06-13
**Status:** Approved design — ready for implementation plan

> Point-in-time design artifact. The controlling reference is `docs/architecture.md`
> (catalog model: §3.2). Where this document and the architecture doc disagree, the
> architecture doc wins.

## Problem

USDA FDC and Open Food Facts return long **branded composite** product names that land
verbatim in `catalog_ingredients.name` (e.g. *"ALFREDO BROCCOLI Fettuccine & Broccoli in
a Parmesan & Romano Cheese Sauce…"*). As a result, a clean canonical ingredient such as
*"Cheese, cheddar"* may never be created, while branded rows are.

#858 already fixed *ranking*: `search_ingredients` (`plnd_data/src/db/search.rs`) orders
exact-match > prefix-match > FTS rank > `length(name)`, so a clean short name out-ranks a
branded composite **when both rows exist**. #906's residual root cause is that the clean
row often is never created in the first place.

**Acceptance:** A clean, canonical ingredient is the primary result for common searches,
independent of which provider supplied the underlying nutrition data.

## Decisions (settled before design)

1. **Approach:** Ingest-side data-type filtering. No new table, no curated layer, no
   schema migration. (Rejected: a curated canonical table — fights the "lazy-populated,
   not hand-curated" catalog of architecture §3.2 and adds permanent maintenance burden.
   Rejected: a query-time branded-name heuristic — fragile against real-world naming.)
2. **OFF role:** Canonical-only seed. The startup catalog seeds only canonical-tier rows
   (USDA Foundation / SR Legacy). Open Food Facts stays in the live search fan-out as a
   nutrition/coverage fallback, surfaced **below** canonical results — never above them.
3. **Backfill:** None. The project has no persistent database (DB is wiped every dev
   build; not yet staged or in production), so there are no existing branded rows to
   clean up. Behavior is forward-only.

## Core principle

USDA FDC becomes the **canonical lane** (clean generic names like *"Cheese, cheddar"*);
Open Food Facts becomes the **branded / coverage lane**. We stop branded composites from
being *created* (seed) or *led with* (live search), and rely on the existing #858 ranking
for everything else.

## Components and changes

### 1. `NutritionProvider` trait — a "canonical source" marker

`plnd_data/src/providers/nutrition.rs`:

```rust
/// Whether this provider yields clean, generic ingredient names suitable for
/// the canonical catalog (vs. branded composite product names).
fn is_canonical_source(&self) -> bool { false }   // default: branded
```

- `UsdaFdcProvider` overrides to `true`.
- `OpenFoodFactsProvider` inherits the `false` default.
- `FixtureNutritionProvider` gains a `canonical: bool` constructor field and returns it,
  so each fixture mirrors the real provider it stands in for.

### 2. USDA provider filters to canonical data types

`plnd_data/src/providers/usda_fdc.rs::search_ingredients` adds the USDA API filter param:

```rust
("dataType", "Foundation,SR Legacy")
```

Defense-in-depth: also parse `dataType` on each search result and drop any non-canonical
row that slips through. This makes the guarantee unit-testable offline, independent of
whether the live API honors the param. `Foundation` + `SR Legacy` are USDA's clean generic
entries; `Branded` and `Survey (FNDDS)` are excluded.

> Implementation note: USDA's GET search accepts `dataType` as a comma-separated value or
> a repeated param. Confirm the exact form works when refreshing fixtures; fall back to
> repeated params if the comma form is rejected.

### 3. Canonical-only seed

`plnd_seed/src/ingredients.rs::fetch_ingredients` filters its provider list to
`is_canonical_source()` before the term loop, logging any skipped (non-canonical)
providers. Result: the startup catalog seeds **only** clean USDA rows; OFF no longer
plants branded products in `catalog_ingredients`.

The seed/live split lives here, not in `main.rs`: `main.rs` keeps passing the full
provider list to both the seeder and the search service; the canonical policy is enforced
in one place (the trait + the seeder's filter).

### 4. Live search — OFF below canonical

- `ProviderSearchService` (`plnd_data/src/search/mod.rs`) exposes
  `is_canonical_source(&self, source: &str) -> bool`, computed from its providers at
  construction.
- `search_ingredients_handler` (`plnd_api/src/routes/search.rs`) buckets the streamed
  external results by source and concatenates **canonical-source results first**, branded
  second. `ProviderSearchEvent::Results { source, .. }` already carries the source, so no
  DTO change is required. Local seeded results remain the primary results, ahead of all
  external results.

### 5. Fixtures and data flow

The fixture provider replays already-mapped `SearchResult` / `ExternalIngredient` captured
by `just refresh-fixtures` — it does not parse raw USDA wire format. So after the provider
change, run `just refresh-fixtures` (needs `APP_EXTERNAL__USDA_FDC_API_KEY` via Doppler) to
re-capture `nutrition/usda_fdc/{search,lookup}.json` with only canonical entries. The
fixture provider then replays clean data unchanged, so e2e/dev catalogs become clean
automatically.

## Error handling

No new failure modes:

- If USDA ignores or rejects the `dataType` param, the response-side parse still filters.
- A `dataType` param error falls through the existing HTTP error path.
- If the canonical-source filter leaves the seeder with zero providers, it logs and
  no-ops; the catalog stays empty, which is already a supported state (architecture §3.2:
  "the system operates correctly on an empty catalog").

## Testing

- **Unit (USDA):** a mixed-`dataType` search response → only Foundation / SR Legacy
  survive.
- **Unit (seeder):** `fetch_ingredients` with one canonical and one non-canonical stub
  provider → only the canonical provider is queried / contributes rows.
- **Unit (service + handler):** external results from a canonical and a branded source →
  canonical ordered first.
- **Existing tests:** the `db/search.rs` ranking test stays green; update any
  e2e / integration assertions that reference branded fixture names; refresh fixtures.
- Full `just verify` before opening the PR.

## Out of scope

- **LLM-driven generic/brand normalization of branded ingredients** — using the LLM at
  ingest to split branded composite names into a generic name + brand, with a `brand`
  column and dedup-by-generic. This rescues coverage from the branded lane (OFF, USDA
  Branded) that this design relegates to "fallback below." It carries its own data-model
  decision (the dedup semantics re-open candidate #1's curated-layer shape) plus cost /
  latency / determinism trade-offs, so it gets its own brainstorm. Tracked in **#913**.
- A stored `data_tier` / `is_canonical` column on `catalog_ingredients` (considered, not
  chosen — in-memory classification is sufficient and avoids a schema change).
- Any backfill or cleanup migration (no persistent data exists).
- Changes to dish/meal ingestion or the promotion path beyond ingredient sourcing.
