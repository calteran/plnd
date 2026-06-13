# USDA Canonical Corpus Bulk-Ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace top-N live-search seeding of USDA ingredients with a vendored, offline corpus of all ~8,000 Foundation + SR Legacy canonical foods, ranked locally by the existing `#858` search, while keeping the live USDA + Open Food Facts fan-out as the runtime cache-miss fallback. Rolls in `#917` (typed `FdcDataType` enum).

**Architecture:** A developer tool downloads + slims USDA's bulk datasets into a `< 1 MB` gzipped JSONL committed at `plnd_data/corpus/usda_canonical.jsonl.gz`. The boot seeder bulk-loads it (offline, prod + e2e). Corpus *parsing* lives in `plnd_data` (reusing the live provider's nutrient map so they cannot drift); corpus *seeding* lives in `plnd_seed`. The runtime `/search/ingredients` fan-out is unchanged except for hardening USDA's `dataType` classification.

**Tech Stack:** Rust (axum, sqlx, serde, flate2), PostgreSQL FTS, Playwright (e2e), `just`.

**Reference spec:** `.claude/worktrees/feat+usda-canonical-corpus/docs/superpowers/specs/2026-06-13-usda-canonical-corpus-design.md`

**Working directory:** all paths are relative to the worktree root `/Users/robert/Development/plnd/.claude/worktrees/feat+usda-canonical-corpus`. Use `git -C <worktree>` for git, or run from the worktree.

---

## File Structure

**Create:**
- `plnd_data/src/providers/usda_fdc.rs` — add `parse_bulk_dataset` + extracted `detail_to_ingredient` (same file, reuses private types).
- `plnd_seed/src/bin/build_usda_corpus.rs` — dev tool: bulk JSON → slim gzipped JSONL.
- `scripts/refresh-usda-corpus.sh` — auto-discover + download + unzip + invoke the bin.
- `plnd_data/corpus/usda_canonical.jsonl.gz` — vendored corpus artifact (generated).
- `plnd_data/corpus/NOTICE` — provenance.
- `plnd_data/migrations/0046_catalog_ingredients_fts_index.sql` — GIN FTS index.

**Modify:**
- `plnd_data/src/providers/usda_fdc.rs` — `#917` `FdcDataType` enum; `detail_to_ingredient`; `parse_bulk_dataset`.
- `plnd_seed/Cargo.toml` — add `flate2`.
- `plnd_seed/src/error.rs` — add `Io` variant.
- `plnd_seed/src/ingredients.rs` — remove `fetch_ingredients`/`INGREDIENT_TERMS`; add `load_corpus_ingredients`; bulk-insert via `QueryBuilder`.
- `plnd_seed/src/lib.rs` — `seed`/`run_seed` load corpus, drop `nutrition_providers` param.
- `plnd_seed/src/bin/seed.rs` — update `seed(...)` call.
- `plnd_seed/tests/seed_test.rs` — drop `INGREDIENT_TERMS` tests.
- `plnd_api/src/main.rs` — update `run_seed(...)` call; drop USDA from debug `build_nutrition_providers`.
- `plnd_data/fixtures/nutrition/usda_fdc/` — delete (no longer used; corpus seeds e2e).
- `scripts/refresh-catalog-fixtures.sh` — drop USDA capture; keep OFF + TheMealDB.
- `plnd_client/e2e/tests/catalog-library.e2e.ts` — rewrite path-2 onto Open Food Facts.
- `docs/architecture.md` — §3.2.1 wording.
- `justfile` — add `refresh-usda-corpus` recipe.

---

## Task 1: Add `flate2` dependency and `SeedError::Io`

**Files:**
- Modify: `plnd_seed/Cargo.toml`
- Modify: `plnd_seed/src/error.rs`

- [ ] **Step 1: Add `flate2` to `plnd_seed/Cargo.toml`**

Under `[dependencies]`, after the `anyhow = "1.0"` line, add:

```toml
flate2 = "1"
```

- [ ] **Step 2: Add an `Io` variant to `SeedError`**

In `plnd_seed/src/error.rs`, add a variant inside the `enum SeedError`:

```rust
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo build -p plnd_seed`
Expected: builds (flate2 resolves from the workspace lockfile; `flate2 1.1.9` is already present).

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add plnd_seed/Cargo.toml plnd_seed/src/error.rs Cargo.lock
git -C <worktree> commit -m "chore(seed): add flate2 dep and SeedError::Io for corpus loading"
```

---

## Task 2: Bulk-dataset parser in `plnd_data` (reuse nutrient map)

USDA's *bulk* per-food object is the same shape as the `food/{id}` detail object already
modeled by `FdcDetailFood`; only the top-level envelope differs (`{"FoundationFoods":[…]}` /
`{"SRLegacyFoods":[…]}`). We extract the existing detail→ingredient mapping and add a bulk parser.

**Files:**
- Modify: `plnd_data/src/providers/usda_fdc.rs`

- [ ] **Step 1: Write failing unit tests for the bulk parser**

Add to the `#[cfg(test)] mod tests` block in `plnd_data/src/providers/usda_fdc.rs`:

```rust
    #[test]
    fn parse_bulk_foundation_envelope_maps_food() {
        let json = r#"{
            "FoundationFoods": [
                {
                    "fdcId": 2262072,
                    "description": "Oats, whole grain, rolled",
                    "foodCategory": { "description": "Cereal Grains and Pasta" },
                    "foodPortions": [{ "gramWeight": 40.0 }],
                    "foodNutrients": [
                        { "nutrient": { "id": 1008 }, "amount": 379.0 },
                        { "nutrient": { "id": 1003 }, "amount": 13.2 }
                    ]
                }
            ]
        }"#;
        let foods = parse_bulk_dataset(json).expect("parse");
        assert_eq!(foods.len(), 1);
        assert_eq!(foods[0].external_id, "2262072");
        assert_eq!(foods[0].name, "Oats, whole grain, rolled");
        assert_eq!(foods[0].serving_size_g, Some(rust_decimal::Decimal::try_from(40.0).unwrap()));
        assert_eq!(foods[0].nutrition.as_ref().unwrap().calories_kcal, Some(379.0));
        assert_eq!(foods[0].occasion_tags, vec!["Cereal Grains and Pasta".to_string()]);
    }

    #[test]
    fn parse_bulk_sr_legacy_envelope_maps_food() {
        let json = r#"{
            "SRLegacyFoods": [
                { "fdcId": 173410, "description": "Milk, whole",
                  "foodNutrients": [ { "nutrient": { "id": 1008 }, "amount": 61.0 } ] }
            ]
        }"#;
        let foods = parse_bulk_dataset(json).expect("parse");
        assert_eq!(foods.len(), 1);
        assert_eq!(foods[0].name, "Milk, whole");
        // serving size defaults to 100 g when no foodPortions present
        assert_eq!(foods[0].serving_size_g, Some(rust_decimal::Decimal::from(100u32)));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p plnd_data parse_bulk -- --nocapture`
Expected: FAIL — `cannot find function parse_bulk_dataset`.

- [ ] **Step 3: Extract `detail_to_ingredient` and add `parse_bulk_dataset`**

In `plnd_data/src/providers/usda_fdc.rs`, add this free function near `build_nutrition_from_detail` (after line ~120):

```rust
/// Map a parsed USDA food (detail-endpoint or bulk-dataset shape) to an
/// `ExternalIngredient`. Shared by the live `get_ingredient_by_id` path and the
/// offline bulk-corpus parser so the two cannot drift.
fn detail_to_ingredient(food: FdcDetailFood) -> ExternalIngredient {
    let serving_size_g = food
        .food_portions
        .as_deref()
        .and_then(|p| p.first())
        .and_then(|p| Decimal::try_from(p.gram_weight).ok())
        .unwrap_or(Decimal::from(100u32));
    let nutrition = build_nutrition_from_detail(&food.food_nutrients);
    let category = food.food_category.map(|c| c.description);
    ExternalIngredient {
        external_id: food.fdc_id.to_string(),
        name: food.description,
        serving_size_g: Some(serving_size_g),
        nutrition: Some(nutrition),
        allergens: vec![], // USDA FDC does not provide allergen data
        occasion_tags: category.into_iter().collect(),
    }
}

/// Bulk USDA dataset envelope. Foundation files wrap foods in `FoundationFoods`,
/// SR Legacy in `SRLegacyFoods`; both share the per-food `FdcDetailFood` shape.
#[derive(Deserialize)]
struct FdcBulkDataset {
    #[serde(alias = "FoundationFoods", alias = "SRLegacyFoods")]
    foods: Vec<FdcDetailFood>,
}

/// Parse a USDA bulk dataset JSON (Foundation or SR Legacy) into ingredients.
/// Used by the `build_usda_corpus` dev tool; not on the request path.
pub fn parse_bulk_dataset(json: &str) -> Result<Vec<ExternalIngredient>, serde_json::Error> {
    let ds: FdcBulkDataset = serde_json::from_str(json)?;
    Ok(ds.foods.into_iter().map(detail_to_ingredient).collect())
}
```

Then refactor `get_ingredient_by_id` to reuse it: replace the trailing `Ok(Some(ExternalIngredient { … }))` block (currently lines ~249-266) with:

```rust
        Ok(Some(detail_to_ingredient(food)))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p plnd_data usda_fdc -- --nocapture`
Expected: PASS — new `parse_bulk_*` tests green, existing `usda_fdc` tests still green.

- [ ] **Step 5: Verify envelope keys against real data (guard)**

> NOTE for the implementer: the `FoundationFoods` / `SRLegacyFoods` keys are stable but unverified
> against a fresh download until Task 4. If Task 4's downloaded files use different top-level keys,
> add them as further `#[serde(alias = …)]` entries on `FdcBulkDataset::foods` and re-run Step 4.

- [ ] **Step 6: Commit**

```bash
git -C <worktree> add plnd_data/src/providers/usda_fdc.rs
git -C <worktree> commit -m "feat(usda): bulk-dataset parser reusing detail_to_ingredient mapping (#918)"
```

---

## Task 3: Roll in #917 — typed `FdcDataType` enum

**Files:**
- Modify: `plnd_data/src/providers/usda_fdc.rs`

- [ ] **Step 1: Write failing tests for the enum**

Replace the existing `canonical_data_types_are_foundation_and_sr_legacy` and
`search_food_deserializes_data_type` tests with:

```rust
    #[test]
    fn fdc_data_type_classifies_canonical_and_fails_closed() {
        assert!(FdcDataType::Foundation.is_canonical());
        assert!(FdcDataType::SrLegacy.is_canonical());
        assert!(!FdcDataType::Branded.is_canonical());
        assert!(!FdcDataType::SurveyFndds.is_canonical());
        // Unknown/renamed types fail closed (non-canonical).
        assert!(!FdcDataType::Unknown.is_canonical());
    }

    #[test]
    fn fdc_data_type_deserializes_wire_strings() {
        let parse = |s: &str| serde_json::from_str::<FdcDataType>(&format!("\"{s}\"")).unwrap();
        assert_eq!(parse("Foundation"), FdcDataType::Foundation);
        assert_eq!(parse("SR Legacy"), FdcDataType::SrLegacy);
        assert_eq!(parse("Branded"), FdcDataType::Branded);
        assert_eq!(parse("Survey (FNDDS)"), FdcDataType::SurveyFndds);
        // A renamed/unknown type maps to Unknown rather than failing to parse.
        assert_eq!(parse("Standard Reference Legacy"), FdcDataType::Unknown);
    }

    #[test]
    fn search_food_deserializes_data_type() {
        let json = r#"{ "fdcId": 1, "description": "ALFREDO BROCCOLI ...", "dataType": "Branded" }"#;
        let food: FdcSearchFood = serde_json::from_str(json).expect("deserialize");
        assert_eq!(food.data_type, Some(FdcDataType::Branded));
        assert!(
            !food.data_type.map(|d| d.is_canonical()).unwrap_or(false),
            "branded composite must be classified non-canonical"
        );
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p plnd_data usda_fdc`
Expected: FAIL — `cannot find type FdcDataType`.

- [ ] **Step 3: Add the enum and use it**

In `plnd_data/src/providers/usda_fdc.rs`, replace the `is_canonical_data_type` fn (lines ~10-14) with:

```rust
/// USDA FDC data types. `Foundation` + `SR Legacy` carry clean generic names;
/// everything else (including unknown/renamed types via `#[serde(other)]`) is
/// non-canonical, so the client-side filter fails closed if USDA renames a type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum FdcDataType {
    Foundation,
    #[serde(rename = "SR Legacy")]
    SrLegacy,
    Branded,
    #[serde(rename = "Survey (FNDDS)")]
    SurveyFndds,
    #[serde(other)]
    Unknown,
}

impl FdcDataType {
    fn is_canonical(self) -> bool {
        matches!(self, FdcDataType::Foundation | FdcDataType::SrLegacy)
    }
}
```

Change the `FdcSearchFood::data_type` field (line ~47) from:

```rust
    #[serde(rename = "dataType")]
    data_type: Option<String>,
```

to:

```rust
    #[serde(rename = "dataType")]
    data_type: Option<FdcDataType>,
```

In `search_ingredients`, change the filter (line ~191) from:

```rust
            .filter(|f| is_canonical_data_type(f.data_type.as_deref()))
```

to:

```rust
            .filter(|f| f.data_type.map(FdcDataType::is_canonical).unwrap_or(false))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p plnd_data usda_fdc`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add plnd_data/src/providers/usda_fdc.rs
git -C <worktree> commit -m "feat(usda): typed FdcDataType enum, fail closed on unknown types (#917)"
```

---

## Task 4: Corpus builder bin + refresh script + just recipe

**Files:**
- Create: `plnd_seed/src/bin/build_usda_corpus.rs`
- Create: `scripts/refresh-usda-corpus.sh`
- Modify: `plnd_seed/Cargo.toml`
- Modify: `justfile`

- [ ] **Step 1: Declare the new binary in `plnd_seed/Cargo.toml`**

After the existing `[[bin]]` block for `seed`, add:

```toml
[[bin]]
name = "build_usda_corpus"
path = "src/bin/build_usda_corpus.rs"
```

- [ ] **Step 2: Write the builder binary**

Create `plnd_seed/src/bin/build_usda_corpus.rs`:

```rust
//! Dev tool (not on the boot path): read USDA Foundation + SR Legacy bulk JSON
//! files, project each food down to the fields we ingest, and write a compact,
//! fdcId-sorted, gzipped JSONL corpus. Invoked by scripts/refresh-usda-corpus.sh.
//!
//! Usage: build_usda_corpus <foundation.json> <sr_legacy.json> <out.jsonl.gz>

use std::io::Write;

use flate2::Compression;
use flate2::write::GzEncoder;
use plnd_data::providers::usda_fdc::parse_bulk_dataset;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        anyhow::bail!("usage: build_usda_corpus <foundation.json> <sr_legacy.json> <out.jsonl.gz>");
    }

    let mut all = Vec::new();
    for path in [&args[1], &args[2]] {
        // The full SR Legacy file is ~205 MB uncompressed; reading it whole is
        // acceptable for an occasional dev tool.
        let json = std::fs::read_to_string(path)?;
        let mut foods = parse_bulk_dataset(&json)
            .map_err(|e| anyhow::anyhow!("parse {path}: {e}"))?;
        all.append(&mut foods);
    }

    // Sort by numeric fdcId for reviewable diffs; dedup defensively.
    all.sort_by_key(|i| i.external_id.parse::<i64>().unwrap_or(i64::MAX));
    all.dedup_by(|a, b| a.external_id == b.external_id);

    let out = std::fs::File::create(&args[3])?;
    let mut enc = GzEncoder::new(out, Compression::default());
    for ing in &all {
        serde_json::to_writer(&mut enc, ing)?;
        enc.write_all(b"\n")?;
    }
    enc.finish()?;

    eprintln!("wrote {} ingredients to {}", all.len(), args[3]);
    Ok(())
}
```

- [ ] **Step 3: Write the refresh script (auto-discovers latest releases)**

Create `scripts/refresh-usda-corpus.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
#
# Regenerate the vendored USDA canonical corpus from the official bulk downloads.
# Auto-discovers the latest Foundation + SR Legacy JSON zip URLs on every run, so
# a new Foundation release is picked up without editing pinned URLs. Public-domain
# data; no API key required. Invoked by `just refresh-usda-corpus`.
#
# Required tools: bash, curl, unzip, jq is NOT needed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORPUS_DIR="${REPO_ROOT}/plnd_data/corpus"
OUT="${CORPUS_DIR}/usda_canonical.jsonl.gz"
BASE="https://fdc.nal.usda.gov"
LISTING="${BASE}/download-datasets/"

mkdir -p "${CORPUS_DIR}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "→ Discovering latest dataset URLs from ${LISTING}"
page="$(curl -fsSL "${LISTING}")"

# Grab the newest-dated json zip filename for each dataset. The page lists files
# like FoodData_Central_foundation_food_json_2026-04-30.zip; sort picks the latest.
find_latest() {
    local pattern="$1"
    printf '%s' "${page}" \
        | grep -oE "/fdc-datasets/FoodData_Central_${pattern}_json_[0-9-]+\.zip" \
        | sort -u | tail -n1
}

foundation_path="$(find_latest 'foundation_food')"
sr_legacy_path="$(find_latest 'sr_legacy_food')"

if [[ -z "${foundation_path}" || -z "${sr_legacy_path}" ]]; then
    echo "ERROR: could not locate dataset zip links on the download page." >&2
    echo "       The page layout may have changed; inspect ${LISTING}." >&2
    exit 1
fi

foundation_url="${BASE}${foundation_path}"
sr_legacy_url="${BASE}${sr_legacy_path}"
echo "  Foundation: ${foundation_url}"
echo "  SR Legacy:  ${sr_legacy_url}"

echo "→ Downloading + unzipping"
curl -fsSL "${foundation_url}" -o "${TMP}/foundation.zip"
curl -fsSL "${sr_legacy_url}" -o "${TMP}/sr_legacy.zip"
unzip -q -o "${TMP}/foundation.zip" -d "${TMP}/foundation"
unzip -q -o "${TMP}/sr_legacy.zip" -d "${TMP}/sr_legacy"

foundation_json="$(find "${TMP}/foundation" -name '*.json' | head -n1)"
sr_legacy_json="$(find "${TMP}/sr_legacy" -name '*.json' | head -n1)"

echo "→ Building slim corpus"
( cd "${REPO_ROOT}" && cargo run --quiet -p plnd_seed --bin build_usda_corpus -- \
    "${foundation_json}" "${sr_legacy_json}" "${OUT}" )

# Record provenance.
cat > "${CORPUS_DIR}/NOTICE" <<EOF
USDA FoodData Central — Foundation Foods + SR Legacy.
Source: ${foundation_url}
        ${sr_legacy_url}
These data are produced by the U.S. Department of Agriculture and are in the
public domain (17 U.S.C. § 105). Slimmed to the fields PLND ingests via
plnd_seed/src/bin/build_usda_corpus.rs.
EOF

echo "✅ Wrote ${OUT}"
echo "   Review: git diff --stat plnd_data/corpus/ && commit if intentional."
```

- [ ] **Step 4: Add the `just` recipe**

In `justfile`, after the `refresh-fixtures` recipe, add:

```just
# Regenerate the vendored USDA canonical corpus (plnd_data/corpus/). Auto-discovers
# the latest Foundation + SR Legacy releases. Public-domain data; no key needed.
# Run twice a year when USDA publishes a new Foundation release.
refresh-usda-corpus:
    scripts/refresh-usda-corpus.sh
```

- [ ] **Step 5: Verify the binary compiles**

Run: `cargo build -p plnd_seed --bin build_usda_corpus`
Expected: builds clean.

- [ ] **Step 6: Commit (tool only — corpus artifact comes in Task 5)**

```bash
git -C <worktree> add plnd_seed/Cargo.toml plnd_seed/src/bin/build_usda_corpus.rs scripts/refresh-usda-corpus.sh justfile
git -C <worktree> commit -m "feat(seed): USDA corpus builder tool + refresh-usda-corpus recipe (#918)"
```

---

## Task 5: Generate and vendor the corpus artifact

**Files:**
- Create: `plnd_data/corpus/usda_canonical.jsonl.gz`
- Create: `plnd_data/corpus/NOTICE`

- [ ] **Step 1: Run the refresh tool (requires network)**

Run: `just refresh-usda-corpus`
Expected: prints discovered URLs, downloads, builds, ends with `✅ Wrote …` and a count near ~8,000.

- [ ] **Step 2: Sanity-check the artifact**

Run: `ls -lh plnd_data/corpus/usda_canonical.jsonl.gz && zcat plnd_data/corpus/usda_canonical.jsonl.gz | head -1 | python3 -m json.tool`
Expected: file is `< 1 MB`; first record is a valid JSON object with `external_id`, `name`, `nutrition`.

- [ ] **Step 3: Confirm key foods are present and clean**

Run: `zcat plnd_data/corpus/usda_canonical.jsonl.gz | grep -iE '"name":"(Oats|Milk|Apple)' | head`
Expected: clean generic names ("Oats, …", "Milk, …", "Apples, …") appear — these are the foods #918 needs rankable.

- [ ] **Step 4: Commit the vendored corpus**

```bash
git -C <worktree> add plnd_data/corpus/usda_canonical.jsonl.gz plnd_data/corpus/NOTICE
git -C <worktree> commit -m "data(catalog): vendor slim USDA canonical corpus (~8k foods, <1MB) (#918)"
```

---

## Task 6: Corpus loader + bulk insert in `plnd_seed`

**Files:**
- Modify: `plnd_seed/src/ingredients.rs`

- [ ] **Step 1: Write a failing test for the loader + bulk insert**

Replace the entire `#[cfg(test)] mod tests` block in `plnd_seed/src/ingredients.rs` with:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use std::io::Write;

    fn write_temp_corpus(records: &[ExternalIngredient]) -> tempfile::NamedTempFile {
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut enc = GzEncoder::new(f.reopen().unwrap(), Compression::default());
        for r in records {
            serde_json::to_writer(&mut enc, r).unwrap();
            enc.write_all(b"\n").unwrap();
        }
        enc.finish().unwrap();
        f
    }

    #[test]
    fn load_corpus_reads_gzipped_jsonl() {
        let recs = vec![ExternalIngredient {
            external_id: "173410".to_string(),
            name: "Milk, whole".to_string(),
            serving_size_g: Some(rust_decimal::Decimal::from(100u32)),
            nutrition: None,
            allergens: vec![],
            occasion_tags: vec![],
        }];
        let f = write_temp_corpus(&recs);
        let loaded = load_corpus_ingredients(f.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].0, "usda_fdc");
        assert_eq!(loaded[0].1.name, "Milk, whole");
    }

    #[sqlx::test(migrations = "../plnd_data/migrations")]
    async fn insert_ingredients_bulk_inserts_and_is_idempotent(pool: sqlx::PgPool) {
        let recs = vec![
            ExternalIngredient {
                external_id: "1".to_string(),
                name: "Oats".to_string(),
                serving_size_g: Some(rust_decimal::Decimal::from(40u32)),
                nutrition: Some(plnd_data::providers::dtos::NutritionFacts {
                    calories_kcal: Some(379.0),
                    ..Default::default()
                }),
                allergens: vec![],
                occasion_tags: vec![],
            },
            ExternalIngredient {
                external_id: "2".to_string(),
                name: "Milk".to_string(),
                serving_size_g: None,
                nutrition: None,
                allergens: vec![],
                occasion_tags: vec![],
            },
        ];
        let pairs: Vec<(String, ExternalIngredient)> =
            recs.into_iter().map(|r| ("usda_fdc".to_string(), r)).collect();

        let mut tx = pool.begin().await.unwrap();
        let n = insert_ingredients(&mut tx, &pairs).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(n, 2);

        // Re-insert: ON CONFLICT DO NOTHING means zero new rows.
        let mut tx = pool.begin().await.unwrap();
        let n2 = insert_ingredients(&mut tx, &pairs).await.unwrap();
        tx.commit().await.unwrap();
        assert_eq!(n2, 0);

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM catalog_ingredients WHERE external_source = 'usda_fdc'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 2);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p plnd_seed load_corpus_reads_gzipped_jsonl`
Expected: FAIL — `cannot find function load_corpus_ingredients`.

- [ ] **Step 3: Rewrite `plnd_seed/src/ingredients.rs` head + insert**

Replace the top of the file (the `use` block, `INGREDIENT_TERMS`, and `fetch_ingredients`) — i.e. everything from line 1 through the end of `fetch_ingredients` (the `}` at line ~110) — with:

```rust
use std::io::{BufRead, BufReader};
use std::path::Path;

use flate2::read::GzDecoder;
use plnd_data::providers::dtos::ExternalIngredient;
use sqlx::PgConnection;

use crate::error::SeedError;

/// Default location of the vendored USDA canonical corpus, relative to the repo
/// root (the API and seed bin both run with the repo root as CWD).
pub const USDA_CORPUS_PATH: &str = "plnd_data/corpus/usda_canonical.jsonl.gz";

/// Load the vendored USDA canonical corpus: a gzipped JSONL of `ExternalIngredient`
/// records. Every row is tagged source `usda_fdc`. Offline and deterministic.
pub fn load_corpus_ingredients(
    path: &Path,
) -> Result<Vec<(String, ExternalIngredient)>, SeedError> {
    let file = std::fs::File::open(path)?;
    let reader = BufReader::new(GzDecoder::new(file));
    let mut out = Vec::new();
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let ingredient: ExternalIngredient = serde_json::from_str(&line)?;
        out.push(("usda_fdc".to_string(), ingredient));
    }
    Ok(out)
}
```

Then replace the existing per-row `insert_ingredients` (lines ~114-153) with a chunked bulk insert:

```rust
/// Bulk-insert (source, ingredient) pairs into `catalog_ingredients`, batched to
/// keep the ~8k-row corpus load fast. ON CONFLICT DO NOTHING on
/// `uq_ingredient_external` keeps it idempotent. Returns the number inserted.
pub async fn insert_ingredients(
    tx: &mut PgConnection,
    ingredients: &[(String, ExternalIngredient)],
) -> Result<usize, SeedError> {
    use uuid::Uuid;

    let mut inserted = 0usize;
    for chunk in ingredients.chunks(1000) {
        let mut qb = sqlx::QueryBuilder::new(
            "INSERT INTO catalog_ingredients \
             (ingredient_id, name, serving_size_g, nutrition, allergens, occasion_tags, \
              external_id, external_source) ",
        );
        qb.push_values(chunk, |mut b, (source, ing)| {
            let nutrition_json = ing
                .nutrition
                .as_ref()
                .and_then(|n| serde_json::to_value(n).ok());
            b.push_bind(Uuid::new_v4())
                .push_bind(&ing.name)
                .push_bind(ing.serving_size_g)
                .push_bind(nutrition_json)
                .push_bind(&ing.allergens)
                .push_bind(&ing.occasion_tags)
                .push_bind(&ing.external_id)
                .push_bind(source);
        });
        qb.push(" ON CONFLICT ON CONSTRAINT uq_ingredient_external DO NOTHING");
        let res = qb.build().execute(&mut *tx).await?;
        inserted += res.rows_affected() as usize;
    }
    Ok(inserted)
}
```

> The per-`(mut b, …)` closure cannot early-return on a serialization error, so a
> nutrition value that fails to serialize is dropped to `NULL` via `.ok()`. In
> practice `NutritionFacts` (all `Option<f64>`) always serializes; this is only a
> belt-and-suspenders fallback.

- [ ] **Step 4: Add `tempfile` to dev-deps if missing**

Check `plnd_seed/Cargo.toml` `[dev-dependencies]`. If `tempfile` is absent, add:

```toml
tempfile = "3"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p plnd_seed load_corpus_reads_gzipped_jsonl && DATABASE_URL=$(doppler secrets get APP_DATABASE__URL --plain 2>/dev/null || echo "$DATABASE_URL") cargo test -p plnd_seed insert_ingredients_bulk`

> The `#[sqlx::test]` needs a live Postgres (the `just verify` DB). If running standalone, ensure `DATABASE_URL` points at the dev DB. Otherwise this test runs inside `just verify` in Task 12.

Expected: PASS (the loader test needs no DB; the bulk-insert test needs the DB).

- [ ] **Step 6: Commit**

```bash
git -C <worktree> add plnd_seed/src/ingredients.rs plnd_seed/Cargo.toml
git -C <worktree> commit -m "feat(seed): corpus loader + chunked bulk ingredient insert (#918)"
```

---

## Task 7: Wire `seed()` to the corpus; drop the nutrition-provider seed param

**Files:**
- Modify: `plnd_seed/src/lib.rs`
- Modify: `plnd_seed/src/bin/seed.rs`
- Modify: `plnd_seed/tests/seed_test.rs`
- Modify: `plnd_api/src/main.rs`

- [ ] **Step 1: Update `seed` and `run_seed` in `plnd_seed/src/lib.rs`**

Change `run_seed` (lines ~14-28) to drop `nutrition_providers` and take a corpus path:

```rust
pub async fn run_seed(
    database_url: &str,
    max_connections: u32,
    recipe_providers: &[Arc<dyn RecipeProvider>],
    corpus_path: &std::path::Path,
) -> Result<(), SeedError> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(600))
        .connect(database_url)
        .await
        .map_err(SeedError::Database)?;
    seed(&pool, recipe_providers, corpus_path).await
}
```

Change `seed` (lines ~37-58) signature + the ingredient-fetch line:

```rust
pub async fn seed(
    pool: &sqlx::PgPool,
    recipe_providers: &[Arc<dyn RecipeProvider>],
    corpus_path: &std::path::Path,
) -> Result<(), SeedError> {
```

Replace the `fetched_ingredients` line (was `ingredients::fetch_ingredients(nutrition_providers).await`) with:

```rust
    let fetched_ingredients = ingredients::load_corpus_ingredients(corpus_path)?;
```

Remove the now-unused `NutritionProvider` import on line 9 (keep `RecipeProvider`).

- [ ] **Step 2: Update the seed bin `plnd_seed/src/bin/seed.rs`**

Remove the USDA/OFF nutrition-provider construction (the `nutrition_providers` vec and the `UsdaFdcProvider`/`OpenFoodFactsProvider`/related env vars used only for it). Change the seed call to:

```rust
    plnd_seed::seed(
        &pool,
        &recipe_providers,
        std::path::Path::new(plnd_seed::ingredients::USDA_CORPUS_PATH),
    )
    .await?;
```

Remove unused imports (`NutritionProvider`, `OpenFoodFactsProvider`, `UsdaFdcProvider`) and the `usda_key`/`off_*` bindings. Keep `TheMealDbProvider`/`RecipeProvider`.

- [ ] **Step 3: Update `plnd_seed/tests/seed_test.rs`**

Remove the `use plnd_seed::ingredients::INGREDIENT_TERMS;` import and the three tests that
reference `INGREDIENT_TERMS` (`test_ingredient_terms_non_empty`, `test_ingredient_search_query_limit`,
and any other `INGREDIENT_TERMS` user). Keep the `DISH_TERMS` tests untouched.

- [ ] **Step 4: Update `plnd_api/src/main.rs` seed spawn**

At the seed spawn (lines ~188-201), drop the nutrition clone and pass the corpus path. Replace:

```rust
        let seed_nutrition = catalog_nutrition.clone();
        let seed_recipe = catalog_recipe.clone();
        tokio::spawn(async move {
            if let Err(e) = plnd_seed::run_seed(&seed_url, 3, &seed_nutrition, &seed_recipe).await {
```

with:

```rust
        let seed_recipe = catalog_recipe.clone();
        tokio::spawn(async move {
            let corpus_path = std::env::var("APP_USDA_CORPUS_PATH")
                .unwrap_or_else(|_| plnd_seed::ingredients::USDA_CORPUS_PATH.to_string());
            if let Err(e) =
                plnd_seed::run_seed(&seed_url, 3, &seed_recipe, std::path::Path::new(&corpus_path)).await
            {
```

(`catalog_nutrition` is still constructed and handed to `ProviderSearchService` below — leave that untouched.)

- [ ] **Step 5: Verify the workspace builds**

Run: `just verify-build`
Expected: clean compile across the workspace.

- [ ] **Step 6: Commit**

```bash
git -C <worktree> add plnd_seed/src/lib.rs plnd_seed/src/bin/seed.rs plnd_seed/tests/seed_test.rs plnd_api/src/main.rs
git -C <worktree> commit -m "refactor(seed): seed USDA from vendored corpus, drop live-search seed path (#918)"
```

---

## Task 8: Drop USDA from the debug fan-out fixtures

In debug builds the search-service fan-out reads fixture providers. With the corpus seeding
USDA locally, the USDA *fixture* is no longer needed; Open Food Facts remains the branded lane.
`is_canonical_source` only buckets *external* (fan-out) results — local corpus rows are ranked by
SQL — so removing the USDA fixture does not affect canonical ordering of seeded rows.

**Files:**
- Modify: `plnd_api/src/main.rs`
- Delete: `plnd_data/fixtures/nutrition/usda_fdc/`
- Modify: `scripts/refresh-catalog-fixtures.sh`

- [ ] **Step 1: Remove the USDA fixture from `build_nutrition_providers`**

In `plnd_api/src/main.rs`, in the debug branch of `build_nutrition_providers` (lines ~553-556), change:

```rust
        return vec![
            Arc::new(make("usda_fdc", "nutrition/usda_fdc").canonical(true)),
            Arc::new(make("openfoodfacts", "nutrition/open_food_facts")),
        ];
```

to:

```rust
        // USDA canonical foods are seeded from the vendored corpus (local hits),
        // so the debug fan-out only needs the Open Food Facts branded lane.
        return vec![Arc::new(make("openfoodfacts", "nutrition/open_food_facts"))];
```

- [ ] **Step 2: Delete the now-unused USDA fixture files**

Run: `git -C <worktree> rm -r plnd_data/fixtures/nutrition/usda_fdc`

- [ ] **Step 3: Strip USDA capture from `scripts/refresh-catalog-fixtures.sh`**

Remove: the `INGREDIENT_TERMS` array, the `USDA_ONLY_TERMS` array, the `USDA_KEY` requirement
check, the entire `── USDA FDC ──` capture block (search + lookup loops and the two
`echo … > "${usda_dir}/…"` writes), and the `usda_dir` mkdir. Change the Open Food Facts loop to
iterate a local term list (OFF still needs terms to capture) — replace `for term in "${INGREDIENT_TERMS[@]}"`
with an explicit `OFF_TERMS` array defined in the script:

```bash
# Terms captured from Open Food Facts for the runtime /search/ingredients fan-out
# fixture (the branded lane). USDA canonical foods come from the vendored corpus,
# not fixtures, so they are not listed here.
OFF_TERMS=(
    "oats"
    "banana"
    "milk"
)
```

Update the comment header to note USDA is corpus-sourced and remove the now-false claim that this
script mirrors `INGREDIENT_TERMS`. Update `just refresh-fixtures` is unaffected (it still calls this script).

- [ ] **Step 4: Verify build + that fixtures still load**

Run: `just verify-build`
Expected: clean compile (no reference to the deleted USDA fixture path remains).

- [ ] **Step 5: Commit**

```bash
# The USDA fixture deletion was already staged by `git rm` in Step 2.
git -C <worktree> add plnd_api/src/main.rs scripts/refresh-catalog-fixtures.sh
git -C <worktree> commit -m "refactor(fixtures): drop USDA fan-out fixture; corpus seeds e2e USDA (#918)"
```

---

## Task 9: GIN FTS index migration

**Files:**
- Create: `plnd_data/migrations/0046_catalog_ingredients_fts_index.sql`

- [ ] **Step 1: Write the migration**

Create `plnd_data/migrations/0046_catalog_ingredients_fts_index.sql`:

```sql
-- The catalog now holds the full USDA canonical corpus (~8k ingredients) instead
-- of ~120 seeded rows, so the FTS predicate in db/search.rs (search_ingredients)
-- warrants a GIN index on the same tsvector expression it queries.
CREATE INDEX IF NOT EXISTS idx_catalog_ingredients_fts
    ON catalog_ingredients
    USING gin (to_tsvector('english', name || ' ' || coalesce(description, '')));
```

- [ ] **Step 2: Verify the migration applies (covered by any `#[sqlx::test]`)**

Run: `cargo build -p plnd_data`
Expected: builds. The migration is exercised by Task 6's `#[sqlx::test]` and by `just verify`.

- [ ] **Step 3: Commit**

```bash
git -C <worktree> add plnd_data/migrations/0046_catalog_ingredients_fts_index.sql
git -C <worktree> commit -m "feat(catalog): GIN FTS index for the full-corpus ingredient search (#918)"
```

---

## Task 10: Rewrite e2e path-2 onto Open Food Facts

With the corpus seeded, `apple` is a local hit; the "fresh external to ingest" must come from the
branded OFF lane (the only fan-out provider in debug). OFF results carry distinct `external_id`s,
so ingesting one creates a new row alongside the corpus USDA rows.

**Files:**
- Modify: `plnd_client/e2e/tests/catalog-library.e2e.ts`

- [ ] **Step 1: Update the path-2 search term and source**

In `plnd_client/e2e/tests/catalog-library.e2e.ts`, in the path-2 test (around lines 148-182):

Change the search URL from `?q=apple` to a term present in the OFF fixture (`OFF_TERMS` in
`refresh-catalog-fixtures.sh`), e.g. `?q=oats`:

```ts
      const searchRes = await fetch(`${apiBase}/search/ingredients?q=oats`, {
        headers: authHeader,
      });
```

Replace the comment block at lines ~157-160 with:

```ts
      // Post-corpus, USDA canonical foods are local hits; the external bucket is
      // the Open Food Facts branded lane (the only fan-out provider under fixtures).
      // So the ingest source below is always 'openfoodfacts'.
```

Change the ingest `external_source` (line ~177) from `'usda_fdc'` to `'openfoodfacts'`:

```ts
          external_source: 'openfoodfacts',
```

- [ ] **Step 2: Confirm the OFF fixture has the chosen term**

Run: `python3 -c "import json;print(list(json.load(open('plnd_data/fixtures/nutrition/open_food_facts/search.json')).keys()))"`
Expected: the term you used (`oats`) is a key. (If `OFF_TERMS` in Task 8 changed the captured set,
re-run `just refresh-fixtures` or pick a term that is present.)

- [ ] **Step 3: Commit (e2e is exercised by `just verify` in Task 12)**

```bash
git -C <worktree> add plnd_client/e2e/tests/catalog-library.e2e.ts
git -C <worktree> commit -m "test(e2e): path-2 ingests Open Food Facts branded hit post-corpus (#918)"
```

---

## Task 11: Update architecture doc

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Revise §3.2.1**

In `docs/architecture.md` §3.2.1 (the "lazy-populated" / three-path discussion, around lines
138-149), add a sentence stating the canonical ingredient lane is bulk-seeded at startup from a
vendored snapshot of the authoritative nutrition dataset, ranked locally, while the live provider
fan-out remains the cache-miss discovery fallback (paths 2/3 unchanged). Keep it abstract — **no
file paths, issue numbers, provider names beyond those already present, or code** (per the doc's
house style: `feedback_architecture_doc_no_code_examples`, `_no_process`).

Suggested insertion after the existing "lazy-populated" sentence:

> The canonical layer is additionally **bulk-seeded** at startup from a vendored snapshot of the
> authoritative public nutrition dataset, so the catalog holds the full canonical namespace and
> ranks it locally; the live provider fan-out below remains the fallback for terms not yet present.

- [ ] **Step 2: Commit (docs-only — no `just verify` needed per CLAUDE.md)**

```bash
git -C <worktree> add docs/architecture.md
git -C <worktree> commit -m "docs(architecture): canonical lane bulk-seeded from vendored snapshot (#918)"
```

---

## Task 12: Full verification + PR

**Files:** none (validation).

- [ ] **Step 1: Run the full pipeline**

Run: `just verify`
Expected: all gates pass — Rust unit/integration tests (incl. Task 2/3/6), build, and e2e
(incl. the rewritten path-2 and path-1 which now sees the full corpus). If path-1 asserted a small
catalog size anywhere, update it to tolerate the full corpus.

- [ ] **Step 2: Manual smoke (optional but recommended)**

With the stack up (`just dev`), hit `GET /search/ingredients?q=oats` and confirm the top `local`
result is a clean "Oats, …" row sourced `usda_fdc`, no live call needed.

- [ ] **Step 3: Final review before PR**

Invoke the code-review subagent on the branch diff (per `feedback_review_before_pr`). Address findings.

- [ ] **Step 4: Rebase + open PR**

```bash
git -C <worktree> fetch origin && git -C <worktree> rebase origin/main
git -C <worktree> push --force-with-lease -u origin <branch>
gh pr create --title "feat(catalog): bulk-ingest USDA canonical corpus + local ranking (#918)" \
  --body "Closes #918. Closes #917. Carries forward #921 (occasion_tags cleanup). See docs/superpowers/specs/2026-06-13-usda-canonical-corpus-design.md."
```

- [ ] **Step 5: Monitor CI** — invoke the `monitor-pr` skill.

---

## Spec coverage check

| Spec section | Task(s) |
|---|---|
| §4.1 corpus builder (auto-discover) | 4, 5 |
| §4.2 parser in plnd_data (reuse map) | 2 |
| §4.3 seeder loader + bulk insert | 6, 7 |
| §4.4 GIN index | 9 |
| §4.5 #917 enum | 3 |
| §5 data flow (corpus seed, live fallback) | 6, 7, 8 |
| §6 fixtures + path-2 + Rust tests | 6, 8, 10 |
| §7 docs | 11 |
| §8 #921 carried forward | 12 (PR body) |
| §9 acceptance | 12 |
