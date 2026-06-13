# Bulk-ingest USDA canonical corpus + local ranking — Design

**Issue:** [#918](https://github.com/calteran/plnd/issues/918) (rolls in [#917](https://github.com/calteran/plnd/issues/917))
**Date:** 2026-06-13
**Status:** Design — pending implementation

---

## 1. Problem

`#906` made USDA FoodData Central the canonical ingredient lane by filtering live
`foods/search` to the `Foundation` + `SR Legacy` data types, removing branded composites.
That win shipped. The residual defect: USDA's `foods/search` is a *research* search whose
relevance ranking buries the plain ingredient under prepared-food variants ("Oil, oat" ranks
above "Oats, whole grain" for the query `oats`; whole milk doesn't appear in the top 10 for
`milk`). Because the seeder captures only the top-N of USDA's ranking, the plain ingredient
never reaches our catalog, so it can never become the primary result.

The data is good; USDA's *search relevance* is the problem. `#858` already built good local
ranking (`exact > prefix > FTS > shortest-name`), but it can only rank what we've ingested,
and today we ingest the top-N of a bad search over ~40 hardcoded terms (~120 rows total).

## 2. Approach

Hold the **whole** USDA canonical corpus locally and rank it with our own `#858` ranking.
The corpus is acquired once, slimmed to the fields we ingest, **vendored into the repo** as a
compact gzipped artifact, and bulk-loaded by the seeder at boot — offline and deterministic,
which matters because the dev database is wiped on every build and e2e must run without network.

Grounding facts (verified against USDA, 2026-06):

- **SR Legacy** — final release April 2018, **7,793 foods**, *will never be updated*.
- **Foundation Foods** — ~467 KB zipped JSON / 6.5 MB raw, updated **bi-annually** (Apr/Oct).
- USDA FDC data is **US-government public domain** (CC0-equivalent) — vendoring is unencumbered.
- We ingest only ~6 fields per food, so a slimmed corpus of ~8,000 foods is **< 1 MB gzipped**.

"Will USDA tolerate frequent full-corpus downloads" is therefore the wrong question: the data
barely changes. We download rarely (only when refreshing the vendored snapshot) and never at boot.

## 3. Decisions (resolved during brainstorm)

| Question | Decision |
|---|---|
| Corpus storage | **Slim derived artifact, vendored in-repo** (gzipped JSONL, ~0.8 MB). Not raw zips, not Git LFS, not build-time download. |
| Capture scope | **All** Foundation + SR Legacy canonical foods (no term subset). |
| Live USDA fate | **Keep the runtime fan-out** as the cache-miss discovery fallback. The corpus replaces *seeding*, not runtime discovery. |
| #917 | **Rolled in** — the live fan-out still classifies USDA results by `dataType`, so harden it with a typed enum. |
| #913 (LLM brand normalization) | **Out of scope** — it concerns the Open Food Facts branded lane, orthogonal to USDA canonical. |
| e2e corpus size | **Full corpus everywhere** — one vendored file seeds both prod and e2e. No subset artifact to maintain. |
| Code home | **Loader in `plnd_seed`, parser in `plnd_data`** — reuse the existing nutrient-ID mapping so the corpus can't drift from the live provider. |
| Synonyms/lemmatization (open Q4) | **YAGNI** — validate with the full corpus first; defer to a follow-up issue only if gaps appear. |

## 4. Components

### 4.1 Corpus builder — `plnd_seed/src/bin/build_usda_corpus.rs`

A developer tool (not on the boot path), invoked via `just refresh-usda-corpus`:

1. **Auto-discovers** the latest Foundation + SR Legacy **JSON** zip URLs on every run by
   fetching USDA's `download-datasets` page and parsing the current
   `FoodData_Central_{foundation_food,sr_legacy_food}_json_YYYY-MM-DD.zip` links — no pinned
   URLs, so a Foundation refresh is picked up automatically. (SR Legacy resolves to its frozen
   `2018-04` file.) The resolved release dates are recorded in `NOTICE`. Both public domain.
2. Parses USDA's **bulk** schema (distinct from the `food/{id}` API schema) via a parser
   exposed from `plnd_data`, projecting each food to the fields we ingest:
   - `fdcId` → `external_id`
   - `description` → `name`
   - `foodCategory.description` → first `occasion_tags` entry (preserves current live-provider
     behavior for parity; the category-vs-occasion overload is flagged for cleanup in **#921**)
   - first `foodPortion.gramWeight` → `serving_size_g` (default 100 g)
   - the 14 mapped nutrient IDs → `NutritionFacts` (reusing `apply_nutrient`)
3. Emits `plnd_data/corpus/usda_canonical.jsonl.gz`: one `ExternalIngredient`-shaped JSON
   record per line, **sorted by `fdcId`** for reviewable diffs, gzip-compressed.
4. Writes `plnd_data/corpus/NOTICE` recording USDA public-domain provenance + the source
   release dates of each input dataset.

**Why a Rust bin, not a bash/jq script:** the nutrient-ID→field mapping already lives in Rust
(`apply_nutrient`); reusing it is the only way to guarantee the vendored corpus and the live
provider never diverge. Cost: exposing a small bulk-schema parser from `plnd_data`.

### 4.2 Corpus parser — `plnd_data` (new module, e.g. `providers::usda_corpus`)

- Public function: parse a USDA bulk JSON dataset (Foundation or SR Legacy shape) into
  `Vec<ExternalIngredient>`, reusing the existing `apply_nutrient` map (promoted from
  private to crate-visible, or a thin public wrapper added).
- Pure, side-effect-free, unit-tested against small inline samples of both bulk shapes.
- Note: USDA's bulk `foodNutrients` carry `nutrient.id` + `amount` much like the API detail
  shape, but the envelope differs (`FoundationFoods` / `SRLegacyFoods` arrays). The parser
  handles the bulk envelope; the nutrient inner-mapping is shared.

### 4.3 Seeder loader — `plnd_seed::ingredients`

- New `load_corpus_ingredients(path) -> Vec<(source, ExternalIngredient)>`: reads the gzipped
  JSONL, deserializes each line. Source is always `usda_fdc`.
- Bulk-insert in a single transaction (batched multi-row `INSERT … ON CONFLICT
  (external_source, external_id) DO NOTHING`), reusing/extending the existing
  `insert_ingredients` path. ~8,000 rows loads sub-second.
- **Replaces** the live-search USDA seeding entirely. Since USDA is the only canonical
  nutrition provider and `fetch_ingredients` already skips non-canonical sources, the live
  ingredient-search seeding path and the now-unused `INGREDIENT_TERMS` list are removed
  outright. (Dish/meal seeding via TheMealDB is unchanged.)
- Corpus path defaults to the vendored file, overridable via env/arg so unit/integration tests
  can point at a small sample corpus.
- The existing "already seeded" fast-skip (`EXISTS … external_source IS NOT NULL`) is retained.

### 4.4 Search index — new migration

A GIN functional index on `to_tsvector('english', name || ' ' || coalesce(description,''))`
over `catalog_ingredients`. Unnecessary at ~120 rows; warranted at ~8,000. The `#858` ranking
SQL is otherwise unchanged.

### 4.5 #917 — typed `FdcDataType` enum (live fan-out hardening)

In `plnd_data::providers::usda_fdc`, replace `data_type: Option<String>` /
`is_canonical_data_type(Option<&str>)` with a typed enum:

```
enum FdcDataType { Foundation, SrLegacy, Branded, SurveyFndds, #[serde(other)] Unknown }
```

`#[serde(rename = …)]` for the wire strings; `Unknown` (the `#[serde(other)]` catch-all)
classifies as **non-canonical** so a renamed/unknown USDA type **fails closed**. Used by the
surviving runtime `search_ingredients` classification.

## 5. Data flow

```
REFRESH (developer, rare):
  just refresh-usda-corpus
    → build_usda_corpus: download zips → plnd_data parser → slim → sort → gzip
    → plnd_data/corpus/usda_canonical.jsonl.gz  (committed)

BOOT (every build, prod + e2e):
  seeder → load_corpus_ingredients(vendored file) → bulk INSERT ~8k rows  [offline]
  seeder → TheMealDB dishes/meals (live or fixture)                       [unchanged]

RUNTIME /search/ingredients?q=…:
  local catalog hit (corpus-backed, #858 ranking)   ← primary, now comprehensive
  else fan-out: live USDA (FdcDataType-filtered) + Open Food Facts  ← fallback (cache-miss)
    → ingest result into catalog
```

## 6. Test & fixture changes

- **Delete** the USDA *seed* fixtures (`fixtures/nutrition/usda_fdc/{search,lookup}.json`):
  the corpus seeds e2e offline, so they're redundant. OFF + TheMealDB runtime fixtures stay.
- **Rewrite e2e path-2** (`catalog-library.e2e.ts`): `apple` now ships in SR Legacy and is a
  *local* hit, inverting the test's premise. Use an Open Food Facts **branded** term absent
  from the corpus as the "fresh external," with `external_source='openfoodfacts'`.
- **New Rust integration test** for the corpus loader: parse a small committed sample → assert
  row count + nutrient mapping + idempotent re-load (per the "backend logic needs fixture-backed
  Rust tests" rule; e2e can't exercise the seed path directly).
- **Unit tests** for the bulk-schema parser (both Foundation and SR Legacy inline samples).
- **`scripts/refresh-catalog-fixtures.sh`**: drop USDA ingredient-term capture (the corpus owns
  the canonical lane); keep OFF + TheMealDB capture for the runtime/dish paths.

## 7. Docs

Update `docs/architecture.md` §3.2.1 to state that the canonical ingredient lane is bulk-seeded
from a vendored authoritative snapshot, while the live provider fan-out remains the cache-miss
discovery fallback. Kept abstract — no file paths, issue numbers, or code, per the doc's house
style.

## 8. Out of scope / follow-ups

- **#913** (LLM generic/brand normalization for the OFF branded lane) — unchanged, separate.
- **#921** — `occasion_tags` overloaded with USDA `foodCategory`; parity preserved here,
  cleanup tracked separately.
- **Synonyms / lemmatization** (open Q4) — only if post-corpus validation shows ranking gaps;
  open a new issue at that point.
- **Foundation refresh automation** — the refresh tool auto-discovers the latest release, but
  *running* it stays a manual `just refresh-usda-corpus` (twice a year); no scheduled job.

## 9. Acceptance

- Searching `oats`, `milk`, `apple`, `cheese` returns the plain canonical ingredient as the
  top result, sourced from the local corpus (no live call).
- The catalog seeds ~8,000 canonical ingredients offline at boot in both prod and e2e.
- `just verify` passes (including the rewritten path-2 and new Rust tests).
- The vendored corpus is < 1 MB and regenerable via `just refresh-usda-corpus`.
- #917's `dataType` classification is enum-typed and fails closed; #918 and #917 both closed.
