# Design: LLM-driven generic/brand normalization for branded ingredient ingest

**Issue:** #913 (follows up #906, builds on #904)
**Date:** 2026-06-15
**Status:** Approved design — pending implementation plan

## Background

#906 made USDA FDC Foundation / SR Legacy the canonical ingredient lane (clean
generic names) and relegated branded sources (Open Food Facts, USDA Branded) to a
fallback lane that sorts below canonical results. Branded sources carry many foods
USDA's curated datasets don't, but their names are branded composites
(e.g. *"Great Value Shredded Cheddar Cheese"*), so they never enter the catalog under
a clean generic name.

This design rescues that coverage by using the LLM, at the point a user promotes a
branded ingredient, to split the branded name into a generic name plus a brand —
storing the generic as `name` and the brand in a new structured column.

### How the catalog works today (grounding)

- `catalog_ingredients` columns: `name`, `description`, `nutrition` (JSONB),
  `allergens`, `occasion_tags`, `external_id`, `external_source`,
  `contributed_by_user_id`. Constraint `uq_ingredient_external UNIQUE (external_source,
  external_id)`. FTS GIN index over `to_tsvector(name || ' ' || COALESCE(description,''))`.
- `UsdaFdcProvider` filters search to `Foundation` + `SR Legacy` and reports
  `is_canonical_source() == true`. Open Food Facts / USDA Branded are non-canonical.
- `/search/ingredients` (`plnd_api/src/routes/search.rs`) splits provider hits into a
  **canonical lane (leads)** and a **branded lane (follows)** via
  `ProviderSearchService::is_canonical_source(source)`.
- The DB ranking in `search_ingredients` (`plnd_data/src/db/search.rs`) already sorts
  exact/prefix name matches and shorter names above long branded composites.
- **The lazy promote-on-select route `/catalog/ingredients/promote` (#904,
  `plnd_api/src/routes/catalog_ingest.rs`) is the only path branded foods currently
  enter the catalog.** The startup seeder (`plnd_seed::run_seed`) seeds only the USDA
  canonical corpus, not branded foods.
- `AppState.agent: AgentService` (`plnd_agent`) already holds an LLM `ProviderRegistry`
  with `Fast` / `Capable` tiers; `MockLlmProvider` exists for tests. Fixture providers
  are gated by `#[cfg(debug_assertions)]` + `APP_EXTERNAL__FIXTURE_PATH`.

## Decisions

| Question | Decision |
| --- | --- |
| Dedup-by-generic semantics | **Per-brand rows sharing a generic `name`, distinguished by a nullable `brand` column.** No new table; each product keeps its own `(external_source, external_id)`, so brands sharing a generic name coexist without violating `uq_ingredient_external`. Every product's nutrition is preserved. |
| Where in the ingest path | **Lazy `/catalog/ingredients/promote` path only** — one LLM call per user-initiated promotion, only for foods a user actually picks. Offline/background backfill is explicitly deferred. |
| Schema | Nullable `brand VARCHAR(100)` on `catalog_ingredients`; FTS index recreated to include `brand`. `uq_ingredient_external` unchanged. |
| Test determinism | A `BrandNormalizer` trait with a live LLM impl and a fixture impl selected by the existing `#[cfg(debug_assertions)]` + fixture-path gate, so e2e (which hits the real backend on promote) and Rust integration tests stay deterministic. |
| Reliability guardrails | **Light: confidence gate + leave-as-is.** Below threshold or no brand detected → keep the original name. Branded rows remain non-canonical and sort below the canonical lane, so a mislabel can only mis-name a fallback row — never displace or corrupt the canonical layer. |

## Architecture

A new `BrandNormalizer` abstraction in `plnd_agent` (where the LLM `ProviderRegistry`
lives), with two implementations chosen at construction — mirroring how nutrition and
recipe providers select fixture vs. live:

- **`LlmBrandNormalizer`** (release builds): a one-shot `Fast`-tier `complete()` call
  with a constrained prompt that returns a structured `{ generic_name, brand,
  confidence }`. Deliberately *not* the full agent `run()` loop — a single completion is
  cheaper and sufficient.
- **`FixtureBrandNormalizer`** (`#[cfg(debug_assertions)]` + `APP_EXTERNAL__FIXTURE_PATH`):
  reads a JSON map of `branded_name → { generic_name, brand, confidence }`. Keeps e2e
  and Rust integration tests deterministic.

The normalizer is exposed to `plnd_api` through `AgentService` (already in `AppState`),
so the promote route gains an LLM hook without `plnd_api` reaching into the registry
directly. Storage-layer isolation is preserved: `plnd_api` still calls the
`CatalogIngestRepository` trait; only the ingest input gains a `brand` field.

### Normalizer interface (shape, not final signature)

```
struct Normalization { generic_name: String, brand: Option<String>, confidence: f64 }

trait BrandNormalizer: Send + Sync {
    async fn normalize(&self, branded_name: &str) -> Option<Normalization>;
}
```

`None` means "could not normalize" (LLM error, parse failure) — the caller falls back to
the original name. A `Some` with `brand: None` or low `confidence` is also treated as
"keep original" by the gate below.

## Data flow

Only `promote_ingredient` in `plnd_api/src/routes/catalog_ingest.rs` changes:

1. Fetch detail via `provider_search.fetch_ingredient_detail(source, id)` — unchanged.
2. **Canonical gate:** if `provider_search.is_canonical_source(source)` → skip
   normalization, ingest as today. USDA canonical names are already clean.
3. Else (branded lane) → call `normalizer.normalize(detail.name)` and apply the gate:
   - `confidence >= 0.7` **and** `brand` present → `name = generic_name`,
     `brand = Some(brand)`.
   - otherwise (low confidence, no brand, or `None`) → `name = original`, `brand = None`.
4. Ingest with the new `brand` field.

The confidence threshold (`0.7`) is a named constant, easily tunable.

## Schema

`plnd_data/migrations/0048_catalog_ingredient_brand.sql` (forward-only; no backfill —
the dev DB is wiped each build):

- `ALTER TABLE catalog_ingredients ADD COLUMN brand VARCHAR(100);` (nullable).
- Drop and recreate the FTS index to include `brand`:
  `to_tsvector('english', name || ' ' || COALESCE(brand,'') || ' ' || COALESCE(description,''))`.
  This keeps brand-token searches (e.g. "Great Value") hitting even though the brand has
  moved out of `name`, while the clean generic `name` still drives the existing
  exact/prefix ranking in `search_ingredients`.
- `uq_ingredient_external` is untouched.

Propagate `brand` through:

- `CatalogIngredient` model (`plnd_data/src/models/catalog.rs`).
- `IngestIngredientInput` (repository trait input) and `IngestIngredientParams`
  (`plnd_data/src/db/catalog_ingest.rs`); the ingest `INSERT` writes `brand`.
- `LocalIngredientResult` + the `search_ingredients` projection (`plnd_data/src/db/search.rs`)
  and the search route response, so the UI can render "Cheddar cheese · Great Value".
- `ingest_input_from_detail` / the promote handler set `brand` from the normalization.

Frontend rendering of the brand beyond exposing the field is left to the consuming UI;
no new frontend styling work is required for this issue.

## Error handling & guardrails

- **Graceful degradation:** any normalizer failure (LLM transport error, parse failure,
  timeout) returns `None` → the original branded name is stored. Promotion never fails
  because of the normalizer.
- **Confidence + brand-presence gate** keeps wrong/uncertain splits out: "Greek yogurt"
  (no brand) and low-confidence guesses keep their original name.
- **Blast radius is the fallback lane only.** Branded rows keep
  `external_source = openfoodfacts | usda_branded`, so `is_canonical_source()` stays
  `false` and they sort below canonical results. A mislabel mis-names a fallback row; it
  can never displace or pollute the canonical layer. This is why no human-in-the-loop
  review is warranted.
- **Latency:** the promote endpoint already performs a provider detail fetch; adding one
  `Fast`-tier completion is acceptable for a user-initiated "add to my catalog" action.

## Testing

- **Unit:** the confidence/brand-presence gate decision (pure function); normalizer
  prompt construction and response parsing round-trip.
- **DB (`sqlx::test`):** `brand` round-trips through ingest; two brands sharing the same
  generic `name` coexist as distinct rows; `search_ingredients` returns both with the
  canonical row leading; a brand-token query hits via the recreated FTS index.
- **Rust integration (fixture-backed, per `docs/architecture.md` §9.7):** drive the
  promote path with `FixtureBrandNormalizer` — branded fixture → generic name + brand;
  low-confidence fixture → original name kept; canonical source → normalizer skipped
  entirely.
- **e2e:** with the fixture normalizer active, promote a known branded fixture result and
  assert the row surfaces under its generic name with brand provenance. Deterministic —
  no live LLM call.

## Out of scope (future issues)

- Offline / background backfill of already-ingested branded rows whose `brand IS NULL`.
- Canonical-parent + linked-variant table shape (#906 candidate #1) — explicitly not
  chosen.
- Frontend brand-badge visual design beyond exposing the `brand` field in API responses.

## Acceptance

Branded-source ingredients promoted via `/catalog/ingredients/promote` are stored and
searchable under clean generic names with brand provenance preserved in the `brand`
column, without regressing the canonical-first ordering established in #906, and with the
LLM normalization fully mockable so e2e and integration tests remain deterministic.
