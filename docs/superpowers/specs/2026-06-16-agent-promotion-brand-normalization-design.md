# Design: brand normalization on the agent meal-promotion path

**Issue:** #940 (follows up #913, flagged in review on #939)
**Date:** 2026-06-16
**Status:** Approved design — pending implementation plan

## Background

#913 added LLM-driven generic/brand normalization for branded ingredients and
wired it into the lazy promote-on-select route `POST /catalog/ingredients/promote`
(`plnd_api/src/routes/catalog_ingest.rs`). That was a deliberate scope decision:
normalize on the single user-initiated promotion, and explicitly **not** in
batch/agent paths, to avoid many LLM calls per operation.

The agent meal-promotion path `promote_new_meal`
(`plnd_api/src/routes/meal_promotion.rs`) resolves ingredients through the
nutrition providers and ingests them via `ingredient_input_from` →
`ingest_ingredient` with `brand: None`. When an ingredient resolves to an Open
Food Facts / USDA Branded result, its branded composite name is ingested
**uncleaned**, bypassing the normalization the promote-on-select path applies.
This is the consistency gap flagged in review on #939.

### Why the cost concern from #913 does not apply here

`ProviderSearchService::resolve_ingredient` (`plnd_data/src/search/mod.rs`)
iterates `nutrition_providers` in order and returns the **first** hit. Production
order is `vec![usda, off]` (`plnd_api/src/main.rs`) — USDA canonical leads, Open
Food Facts (branded) is the fallback. So in a composed meal, every ingredient
USDA covers resolves to a canonical source and **skips the LLM entirely** via the
canonical gate. Only the minority of ingredients USDA lacks fall through to a
branded source and normalize. The #913 brainstorm's fear of "an LLM call per
ingredient" was about normalizing *everything*, including canonical names; the
canonical gate already eliminates that for the bulk.

## Decision

Normalize branded ingredients on the agent meal-promotion path by **reusing the
#913 seam, gated on canonical source** — consistent with promote-on-select. No
new normalization logic. (Alternatives considered: skip-and-document the gap;
normalize with a per-meal cap. Rejected — the canonical gate already bounds cost,
and consistency with promote-on-select is the acceptance criterion's preferred
outcome.)

## Architecture

The decision unit already exists and is tested: `resolve_name_brand(is_canonical,
original_name, &dyn BrandNormalizer) -> (String, Option<String>)` in
`catalog_ingest.rs`, which applies the confidence + brand-presence gate
(`Normalization::gated`) and falls back to the original name on any normalizer
failure. This change is a **threading** change — reusing that unit at two new
call sites — not new behavior.

### Change set (4 files)

1. **`plnd_api/src/routes/catalog_ingest.rs`** — promote `resolve_name_brand`
   from a private `async fn` to `pub(crate)`. No logic change.

2. **`plnd_api/src/routes/meal_promotion.rs`**:
   - `promote_new_meal` gains a `normalizer: &dyn plnd_agent::BrandNormalizer`
     parameter.
   - `ingredient_input_from` gains `name: String, brand: Option<String>`
     parameters (mirroring `ingest_input_from_detail` in `catalog_ingest.rs`),
     replacing the hardcoded `ing.name` / `brand: None`.
   - At **both** ingest call sites — Branch 1 (recipe-match) and Branch 2
     (inferred-ingredient compose) — after `search.resolve_ingredient` returns
     `(ing_source, ing)`:
     ```
     let is_canonical = search.is_canonical_source(&ing_source);
     let (name, brand) = resolve_name_brand(is_canonical, &ing.name, normalizer).await;
     ```
     then ingest with `ingredient_input_from(&ing_source, &ing, name, brand)`.
     Canonical USDA hits return early inside `resolve_name_brand` → no LLM call.

3. **`plnd_api/src/routes/agent.rs`** — pass `state.brand_normalizer.as_ref()`
   as the new 5th argument to `promote_new_meal`. `AppState.brand_normalizer:
   Arc<dyn BrandNormalizer>` is already constructed (live vs. fixture chosen by
   the debug + fixture-path gate in `main.rs`).

## Data flow

For each ingredient resolved during promotion (both branches):

1. `resolve_ingredient(name)` → `(source, detail)` — unchanged.
2. `is_canonical = is_canonical_source(source)`.
3. `resolve_name_brand(is_canonical, detail.name, normalizer)`:
   - canonical → `(detail.name, None)`, no LLM call.
   - branded → `normalizer.normalize(detail.name)`, then `Normalization::gated`:
     confidence `>= 0.7` and a non-empty brand → `(generic_name, Some(brand))`;
     otherwise (low confidence, no brand, or normalizer `None`) → `(detail.name,
     None)`.
4. Ingest with the resolved `(name, brand)`.

## Error handling & guardrails

Inherited unchanged from #913: any normalizer failure (LLM transport error, parse
failure, output exceeding column limits) returns `None` → the original branded
name is stored; promotion never fails because of the normalizer. Branded rows keep
`external_source = openfoodfacts | usda_branded`, so a mislabel only mis-names a
fallback-lane row, never the canonical layer.

## Testing

- **Unit (`meal_promotion.rs`):** thread a normalizer into every existing
  `promote_new_meal` test call. The existing test nutrition providers are
  non-canonical (`NutritionProvider::is_canonical_source` defaults to `false`), so
  a `FixtureBrandNormalizer` returning `None` for their names keeps the gate on the
  original name and leaves existing expectations unchanged.
- **New test:** a recording repo that captures the ingested `IngestIngredientInput`
  `name`/`brand`, asserting (a) a **branded** (non-canonical) ingredient mapped in
  the brand fixture is ingested under its cleaned generic name with `brand` set,
  and (b) a **canonical** ingredient skips normalization (original name, `brand:
  None`) even when a fixture entry exists for it.
- **Determinism:** `FixtureBrandNormalizer` is the debug-build normalizer, so no
  live LLM call in tests or e2e.

## Out of scope

- No migration, schema, or frontend change (the `brand` column and its FTS
  indexing already exist from #913).
- No e2e fixture-file change: `/agent/*` is browser-mocked in e2e, so the agent
  promotion path is exercised by fixture-backed Rust tests, not Playwright.
- Offline/background backfill of already-ingested branded rows whose `brand IS
  NULL` remains deferred (per #913).

## Acceptance

Branded-source ingredients ingested via the agent meal-promotion path are stored
under clean generic names with `brand` provenance, consistent with the
promote-on-select path, with the LLM normalization fully mockable so Rust
integration tests stay deterministic.
