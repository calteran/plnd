#!/usr/bin/env bash
#
# Capture nutrition + recipe upstream responses into plnd_data/fixtures/.
# Called by `just refresh-fixtures` (which wraps this in `doppler run` so the
# USDA API key is available in env).
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
# Required tools: bash, curl, jq.
# Required env: APP_EXTERNAL__USDA_FDC_API_KEY (USDA FDC), optionally
#               APP_EXTERNAL__THEMEALDB_API_KEY (defaults to "1" — the public
#               TheMealDB test key).
#
# Failure mode: `set -euo pipefail` means any curl or jq failure aborts the
# whole script, leaving the fixture directory in a partially-updated state.
# If a single provider has an outage during refresh, revert the partial
# changes with `git checkout plnd_data/fixtures/` and retry.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES_ROOT="${REPO_ROOT}/plnd_data/fixtures"

# Mirrors INGREDIENT_TERMS in plnd_seed/src/ingredients.rs. Update both if you
# add or remove terms — the seeder iterates this list at boot, and the fixture
# provider keys search results by query term, so these must match for the
# seeder to find any rows under fixtures.
INGREDIENT_TERMS=(
    "oats"
    "banana"
    "chicken breast"
    "brown rice"
    "broccoli"
    "milk"
    "egg"
    "olive oil"
)

# Extra terms captured for the API search endpoint but NOT in INGREDIENT_TERMS,
# so the seeder doesn't ingest them. Used by e2e tests (e.g. path-2) that need
# a "fresh external" to ingest into the local catalog. USDA only — keeping OFF
# off this list means /search/ingredients?q=apple returns only USDA hits, which
# the tests can rely on for source determinism.
USDA_ONLY_TERMS=(
    "apple"
)

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
USDA_KEY="${APP_EXTERNAL__USDA_FDC_API_KEY:-}"
MEALDB_KEY="${APP_EXTERNAL__THEMEALDB_API_KEY:-1}"

if [[ -z "${USDA_KEY}" ]]; then
    echo "ERROR: APP_EXTERNAL__USDA_FDC_API_KEY must be set." >&2
    echo "       Run via 'just refresh-fixtures' (wraps doppler run) or export the key manually." >&2
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required but not found in PATH." >&2
    exit 1
fi

usda_dir="${FIXTURES_ROOT}/nutrition/usda_fdc"
off_dir="${FIXTURES_ROOT}/nutrition/open_food_facts"
mdb_dir="${FIXTURES_ROOT}/recipe/themealdb"
mkdir -p "${usda_dir}" "${off_dir}" "${mdb_dir}"

# Common URL-encode helper: prints args joined by '+' with spaces collapsed.
urlencode_term() {
    # jq -sRr @uri is the simplest portable encoder.
    printf '%s' "$1" | jq -sRr @uri
}

# ── USDA FDC ──────────────────────────────────────────────────────────────────
# Search: https://api.nal.usda.gov/fdc/v1/foods/search?query=<term>&pageSize=N&api_key=KEY
# Detail: https://api.nal.usda.gov/fdc/v1/food/<fdcId>?api_key=KEY
#
# We collect every term's search hits, normalize to SearchResult shape, and
# union the fdcIds for the lookup pass.
echo "→ USDA FDC: capturing search.json and lookup.json"
usda_search_acc='{}'  # keyed by lowercased query term
usda_lookup_acc='{}'  # keyed by fdcId
usda_ids_raw=""       # newline-separated; deduped with sort -u before the lookup pass

# Combined term list for USDA: seeder terms + e2e-only terms.
usda_all_terms=("${INGREDIENT_TERMS[@]}" "${USDA_ONLY_TERMS[@]}")

for term in "${usda_all_terms[@]}"; do
    encoded="$(urlencode_term "${term}")"
    raw="$(curl -fsSL "https://api.nal.usda.gov/fdc/v1/foods/search?query=${encoded}&pageSize=${QUERY_LIMIT}&api_key=${USDA_KEY}")"

    # Normalize to SearchResult: { external_id, name, description, thumbnail_url }
    normalized="$(jq '[.foods[]? | {
        external_id: (.fdcId | tostring),
        name: (.description // ""),
        description: (.foodCategory // null),
        thumbnail_url: null
    }]' <<<"${raw}")"

    term_lower="$(printf '%s' "${term}" | tr '[:upper:]' '[:lower:]')"
    usda_search_acc="$(jq --arg key "${term_lower}" --argjson new "${normalized}" '. + {($key): $new}' <<<"${usda_search_acc}")"

    usda_ids_raw="${usda_ids_raw}$(jq -r '.foods[]?.fdcId' <<<"${raw}")
"
done

while IFS= read -r fdc_id; do
    [[ -z "${fdc_id}" ]] && continue
    raw="$(curl -fsSL "https://api.nal.usda.gov/fdc/v1/food/${fdc_id}?api_key=${USDA_KEY}")"

    # Normalize to ExternalIngredient. USDA returns foodNutrients as a flat
    # array of {nutrient: {name, unitName}, amount}; we extract the canonical
    # macros our NutritionFacts struct cares about.
    # Match nutrients by USDA nutrient ID — the same IDs the live provider uses
    # (see plnd_data/src/providers/usda_fdc.rs:83-101). Matching by `name` is
    # ambiguous: e.g. "Energy" exists as both kcal (id 1008) and kJ (id 1062)
    # for many foods, and `select(.name == "Energy") | first` could pick either.
    entry="$(jq --arg id "${fdc_id}" '
        def nutrient_amount(nid): [.foodNutrients[]? | select(.nutrient.id == nid) | .amount][0];
        {
            ($id): {
                external_id: $id,
                name: (.description // ""),
                serving_size_g: "100",
                nutrition: {
                    calories_kcal: nutrient_amount(1008),
                    protein_g: nutrient_amount(1003),
                    carbohydrates_g: nutrient_amount(1005),
                    fat_g: nutrient_amount(1004),
                    fiber_g: nutrient_amount(1079),
                    sugar_g: nutrient_amount(2000),
                    sodium_mg: nutrient_amount(1093),
                    potassium_mg: nutrient_amount(1092),
                    calcium_mg: nutrient_amount(1087),
                    iron_mg: nutrient_amount(1089),
                    vitamin_c_mg: nutrient_amount(1162),
                    vitamin_d_iu: nutrient_amount(1110),
                    saturated_fat_g: nutrient_amount(1258),
                    cholesterol_mg: nutrient_amount(1253)
                },
                allergens: [],
                occasion_tags: []
            }
        }
    ' <<<"${raw}")"
    usda_lookup_acc="$(jq --argjson new "${entry}" '. * $new' <<<"${usda_lookup_acc}")"
done <<<"$(printf '%s' "${usda_ids_raw}" | sort -u)"

echo "${usda_search_acc}" | jq '.' > "${usda_dir}/search.json"
echo "${usda_lookup_acc}" | jq '.' > "${usda_dir}/lookup.json"

# ── Open Food Facts ───────────────────────────────────────────────────────────
# Search: https://world.openfoodfacts.net/cgi/search.pl?search_terms=<term>&page_size=N&action=process&json=1&lc=en&cc=us
# Detail: https://world.openfoodfacts.net/api/v2/product/<code>.json?lc=en&cc=us
echo "→ Open Food Facts: capturing search.json and lookup.json"
off_search_acc='{}'  # keyed by lowercased query term
off_lookup_acc='{}'  # keyed by product code
off_ids_raw=""

for term in "${INGREDIENT_TERMS[@]}"; do
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
