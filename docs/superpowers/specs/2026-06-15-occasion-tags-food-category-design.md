# Stop overloading `occasion_tags` with USDA `foodCategory` (#921)

**Date:** 2026-06-15
**Status:** Design approved
**Issue:** [#921](https://github.com/calteran/plnd/issues/921) — carried over from #918

## Problem

Both the live `UsdaFdcProvider` and the offline corpus builder map USDA's
`foodCategory.description` (e.g. "Fruits and Fruit Juices") into an ingredient's
`occasion_tags`. A food *category* is not an *occasion*: per architecture §3.2.5,
`occasion_tags` is for breakfast/lunch/dinner/snack-style scheduling hints. Stuffing
taxonomy strings there pollutes the field.

## Audit (consumers of ingredient `occasion_tags`)

Nothing reads it, and nothing reads a food category in any form:

- `search_ingredients` (`plnd_data/src/db/search.rs`) *selects* `occasion_tags` into
  `LocalIngredientResult` but never filters on it.
- The Angular client declares `occasion_tags` on its ingredient interface but **no
  template or component renders it**.
- The occasion-matching that exists (`meal_suggestions.rs`, `search_catalog_meals`)
  operates on `user_meals` / `user_dishes` / `catalog_meals` — never on
  `catalog_ingredients`.

The single source of the pollution is `detail_to_ingredient()` in
`plnd_data/src/providers/usda_fdc.rs`, shared by the live promote path
(`get_ingredient_by_id`) and the offline `parse_bulk_dataset` (used by
`build_usda_corpus`).

Note: a *second* `foodCategory` read exists — `FdcSearchFood.food_category` flows into
`SearchResult.description` (search-dropdown hint). That is a legitimate use and is **left
untouched**.

## Decision

Since nothing consumes the category, **drop the mapping** rather than relocate it to a
new column (YAGNI). No schema change, no migration. Re-derivable from USDA if a future
feature ever needs category data.

Additionally, **remove `ExternalIngredient.occasion_tags`** from the provider DTO: after
this fix both ingredient providers (USDA, Open Food Facts) always emit `[]`, so the field
is dead weight. `ExternalDish.occasion_tags` is unaffected (recipes legitimately carry
occasion hints).

## Changes

### 1. `plnd_data/src/providers/dtos.rs`
- Remove the `occasion_tags` field from `ExternalIngredient` (keep it on `ExternalDish`).

### 2. `plnd_data/src/providers/usda_fdc.rs`
- `detail_to_ingredient()`: stop deriving/assigning category into the ingredient.
- Remove the now-unused `FdcDetailFood.food_category` field and the `FdcFoodCategory`
  struct. (No `deny_unknown_fields`, so a `foodCategory` key in USDA JSON is ignored.)
- Leave `FdcSearchFood.food_category` and `SearchResult.description` alone.
- Update unit tests: `parse_bulk_foundation_envelope_maps_food` no longer asserts a
  category tag; `test_fdc_detail_food_json_round_trip` drops the `food_category`
  assertion.

### 3. Other `ExternalIngredient` construction sites (compiler-enforced sweep)
- `plnd_data/src/providers/open_food_facts.rs`
- `plnd_data/src/providers/nutrition_fixture.rs` (fixture JSON)
- `plnd_data/src/search/mod.rs` (test fixtures, if applicable)
- `plnd_seed/src/ingredients.rs` (tests)
- `plnd_api/src/routes/catalog_ingest.rs` (promote/ingest mapping)
- `plnd_api/tests/external_provider_test.rs` (if it builds `ExternalIngredient`)

The build is the checklist: remove the field, then resolve every resulting error.

### 4. Vendored corpus rebuild (rebuild-from-raw, per decision)
- `just refresh-usda-corpus` → regenerates `plnd_data/corpus/usda_canonical.jsonl.gz`
  (now without `occasion_tags`) + provenance `NOTICE`. Pulls USDA's latest public-domain
  Foundation + SR Legacy release (no API key), so the corpus content also refreshes — an
  accepted consequence of rebuilding.
- `just refresh-usda-test-corpus` → regenerates the slim e2e subset
  `usda_canonical.test.jsonl.gz`.

### 5. No schema / migration
`catalog_ingredients.occasion_tags` stays (still used by meals/dishes); USDA rows are now
`{}`. No backfill — dev DBs reseed from the new corpus (no persistent DB).

## Testing

- Updated Rust unit tests in `usda_fdc.rs`.
- `just verify` — full quality + build + Rust tests + e2e. The e2e catalog path-1
  local-hit test ("oats") runs against the regenerated test corpus, confirming the slim
  subset still seeds.

## Out of scope

- Removing the `occasion_tags` column from `catalog_ingredients` (shared with meals/dishes).
- Any change to dish/meal occasion handling.
