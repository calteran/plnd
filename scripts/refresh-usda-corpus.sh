#!/usr/bin/env bash
#
# Regenerate the vendored USDA canonical corpus from the official bulk downloads.
# Auto-discovers the latest Foundation + SR Legacy JSON zip URLs on every run, so
# a new Foundation release is picked up without editing pinned URLs. Public-domain
# data; no API key required. Invoked by `just refresh-usda-corpus`.
#
# Required tools: bash, curl, unzip.
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
