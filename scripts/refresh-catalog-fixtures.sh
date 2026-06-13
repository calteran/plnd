#!/usr/bin/env bash
#
# Capture nutrition + recipe upstream responses into plnd_data/fixtures/.
# Called by `just refresh-fixtures` (which wraps this in `doppler run` so the
# TheMealDB API key is available in env).
#
# Each provider gets two files:
#   - search.json: a JSON array shaped like the provider's adapter emits
#     (Vec<SearchResult>).
#   - lookup.json: a JSON object keyed by external_id whose values are the
#     adapter's full record (ExternalIngredient or ExternalDish).
#
# The search.json + lookup.json pair is self-consistent: every external_id in
# search.json has a matching entry in lookup.json. This is what the catalog
# seeder needs at boot when APP_EXTERNAL__FIXTURE_PATH is set.
#
# NOTE: USDA canonical ingredient data is now sourced from the vendored corpus
# (plnd_data/corpus/), not from fixtures. Only the Open Food Facts branded lane
# and TheMealDB recipe lane are captured here.
#
# Required tools: bash, curl, jq.
# Required env: optionally APP_EXTERNAL__THEMEALDB_API_KEY (defaults to "1" —
#               the public TheMealDB test key).
#
# Failure mode: `set -euo pipefail` means any curl or jq failure aborts the
# whole script, leaving the fixture directory in a partially-updated state.
# If a single provider has an outage during refresh, revert the partial changes
# with `git checkout plnd_data/fixtures/` and retry.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES_ROOT="${REPO_ROOT}/plnd_data/fixtures"

# Mirrors DISH_TERMS in plnd_seed/src/dishes.rs:10. Update both if you add or
# remove terms — the seeder iterates this list at boot, and the fixture
# provider keys search results by query term, so any mismatch means the seeder
# silently fails to ingest that term's dishes.
DISH_TERMS=(
    "chicken"
    "pasta"
    "scrambled eggs"
    "salad"
    "porridge"
)

QUERY_LIMIT=3
MEALDB_KEY="${APP_EXTERNAL__THEMEALDB_API_KEY:-1}"

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required but not found in PATH." >&2
    exit 1
fi

off_dir="${FIXTURES_ROOT}/nutrition/open_food_facts"
mdb_dir="${FIXTURES_ROOT}/recipe/themealdb"
mkdir -p "${off_dir}" "${mdb_dir}"

# Common URL-encode helper: prints args joined by '+' with spaces collapsed.
urlencode_term() {
    # jq -sRr @uri is the simplest portable encoder.
    printf '%s' "$1" | jq -sRr @uri
}

# ── Open Food Facts ───────────────────────────────────────────────────────────
# Search: https://world.openfoodfacts.net/cgi/search.pl?search_terms=<term>&page_size=N&action=process&json=1&lc=en&cc=us
# Detail: https://world.openfoodfacts.net/api/v2/product/<code>.json?lc=en&cc=us
echo "→ Open Food Facts: capturing search.json and lookup.json"
off_search_acc='{}'  # keyed by lowercased query term
off_lookup_acc='{}'  # keyed by product code
off_ids_raw=""

# Terms captured from Open Food Facts for the runtime /search/ingredients fan-out
# fixture (the branded lane). USDA canonical foods come from the vendored corpus,
# not fixtures, so they are not listed here.
OFF_TERMS=(
    "oats"
    "banana"
    "milk"
)

for term in "${OFF_TERMS[@]}"; do
    encoded="$(urlencode_term "${term}")"
    raw="$(curl -fsSL "https://world.openfoodfacts.net/cgi/search.pl?search_terms=${encoded}&page_size=${QUERY_LIMIT}&action=process&json=1&lc=en&cc=us")"

    normalized="$(jq '[.products[]? | {
        external_id: (.code | tostring),
        name: (.product_name // .generic_name // ""),
        description: (.brands // null),
        thumbnail_url: (.image_thumb_url // null)
    } | select(.external_id != "" and .name != "")]' <<<"${raw}")"

    term_lower="$(printf '%s' "${term}" | tr '[:upper:]' '[:lower:]')"
    off_search_acc="$(jq --arg key "${term_lower}" --argjson new "${normalized}" '. + {($key): $new}' <<<"${off_search_acc}")"

    off_ids_raw="${off_ids_raw}$(jq -r '.products[]?.code // empty' <<<"${raw}")
"
done

while IFS= read -r code; do
    [[ -z "${code}" ]] && continue
    raw="$(curl -fsSL "https://world.openfoodfacts.net/api/v2/product/${code}.json?lc=en&cc=us")"

    # serving_size_g is hardcoded to "100" — the live provider does the same
    # (open_food_facts.rs:124) because OFF normalizes nutrients per 100g and
    # the schema's `serving_size_g` is the canonical reference, not the
    # product's actual serving size.
    entry="$(jq --arg id "${code}" '{
        ($id): (.product // {} | {
            external_id: $id,
            name: (.product_name // .generic_name // ""),
            serving_size_g: "100",
            nutrition: ((.nutriments // {}) | {
                calories_kcal: .["energy-kcal_100g"],
                protein_g: .proteins_100g,
                carbohydrates_g: .carbohydrates_100g,
                fat_g: .fat_100g,
                fiber_g: .fiber_100g,
                sugar_g: .sugars_100g,
                sodium_mg: (.sodium_100g // null | if . == null then null else . * 1000 end),
                potassium_mg: (.potassium_100g // null | if . == null then null else . * 1000 end),
                calcium_mg: (.calcium_100g // null | if . == null then null else . * 1000 end),
                iron_mg: (.iron_100g // null | if . == null then null else . * 1000 end),
                vitamin_c_mg: (.["vitamin-c_100g"] // null | if . == null then null else . * 1000 end),
                vitamin_d_iu: null,
                saturated_fat_g: .["saturated-fat_100g"],
                cholesterol_mg: (.cholesterol_100g // null | if . == null then null else . * 1000 end)
            }),
            allergens: ((.allergens_tags // []) | map(sub("^en:"; ""))),
            occasion_tags: []
        })
    }' <<<"${raw}")"
    off_lookup_acc="$(jq --argjson new "${entry}" '. * $new' <<<"${off_lookup_acc}")"
done <<<"$(printf '%s' "${off_ids_raw}" | sort -u)"

echo "${off_search_acc}" | jq '.' > "${off_dir}/search.json"
echo "${off_lookup_acc}" | jq '.' > "${off_dir}/lookup.json"

# ── TheMealDB ─────────────────────────────────────────────────────────────────
# Search: https://www.themealdb.com/api/json/v1/<key>/search.php?s=<term>
#
# search.json: HashMap<term, Vec<SearchResult>> — same shape as dtos::SearchResult.
# lookup.json: HashMap<idMeal, raw TheMealDB meal object> — parsed at load time by
#   TheMealDbFixtureProvider via parse_meal_json(), which applies the same
#   parse_measure() and category_to_occasion_tags() logic as the live provider.
echo "→ TheMealDB: capturing search.json and lookup.json"
mdb_search_acc='{}'  # keyed by lowercased query term
mdb_lookup_acc='{}'  # keyed by idMeal

for term in "${DISH_TERMS[@]}"; do
    encoded="$(urlencode_term "${term}")"
    raw="$(curl -fsSL "https://www.themealdb.com/api/json/v1/${MEALDB_KEY}/search.php?s=${encoded}")"

    normalized="$(jq '[.meals[]? | {
        external_id: .idMeal,
        name: .strMeal,
        description: .strCategory,
        thumbnail_url: .strMealThumb
    }]' <<<"${raw}")"
    term_lower="$(printf '%s' "${term}" | tr '[:upper:]' '[:lower:]')"
    mdb_search_acc="$(jq --arg key "${term_lower}" --argjson new "${normalized}" '. + {($key): $new}' <<<"${mdb_search_acc}")"

    entries="$(jq --argjson empty '{}' '
        reduce (.meals[]? // empty) as $m ($empty;
            . + {($m.idMeal): $m}
        )
    ' <<<"${raw}")"
    mdb_lookup_acc="$(jq --argjson new "${entries}" '. * $new' <<<"${mdb_lookup_acc}")"
done

echo "${mdb_search_acc}" | jq '.' > "${mdb_dir}/search.json"
echo "${mdb_lookup_acc}" | jq '.' > "${mdb_dir}/lookup.json"

echo "✅ Captured upstream catalog responses into plnd_data/fixtures/."
echo "   Review the diff (git diff plnd_data/fixtures/) and commit if intentional."
