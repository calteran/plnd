# Design: LLM-invented meals, lazily promoted to the catalog

**Date:** 2026-06-12
**Status:** Approved (pending implementation)
**Branch:** `feat/catalog-llm-meal-promotion`

## Problem

The shared meal catalog is seeded with only a handful of items. Because the
meal-planning agent can only return a `meal_ref` of type `catalog` or `user`,
it is structurally forced to recycle the same small set of catalog meals for
every slot of every week. Speculatively bulk-seeding more items is wasteful and
never keeps up with what users actually want.

Instead, let the agent **invent** a meal when nothing in the catalog fits, then
**lazily promote** that invention into the shared catalog by searching the
external provider endpoints (TheMealDB for recipes; USDA FDC / Open Food Facts
for ingredient nutrition) and ingesting the result. This realises the
catalog's intended *lazy-population* model (`docs/architecture.md` §3.2,
path 2 "external-provider hit" and path 3 "user-contributed").

## Decisions (locked)

| Decision | Choice |
|---|---|
| **Trigger** | Backend interception — the agent submits a `new` meal; the API enriches *after* the agent finishes. |
| **Timing** | Inline / synchronous — a real catalog `meal_ref` is resolved before the suggestion returns. |
| **Destination** | Shared catalog (`catalog_meals` + `catalog_dishes` + `catalog_ingredients`). |
| **Provider miss fallback** | Re-invoke the agent for the affected slot, constrained to existing catalog/user items only. |
| **Match scope** | Both: search TheMealDB by name first; if no recipe, resolve the LLM's inferred ingredients via USDA/OFF and compose a meal. Miss = neither yields anything. |
| **Attribution of LLM-composed (non-recipe) meals** | Enter the shared catalog immediately, tagged `external_source = "llm_composed"` + `contributed_by_user_id`. Revisit visibility later. |

## Architecture & flow

The agent gains the *ability to invent* a meal. The **API layer owns
promotion** (provider search → catalog ingest), keeping the agent crate free of
provider and storage concerns. For any open slot:

```
Agent run ──> terminal tool emits meal_ref:
                 { type: "catalog"|"user", id }                       (existing — used verbatim)
                 { type: "new", name, occasion_tags,
                   inferred_ingredients[], estimated_nutrition }       (NEW)
                          │
        ┌─────────────────┴── post-run promotion (API, synchronous) ──────────────┐
        │  1. TheMealDB search by name → fetch full recipe?                        │
        │       hit → ingest catalog_meal + dishes + ingredients → catalog_id      │
        │  2. else resolve inferred_ingredients via USDA/OFF                       │
        │       ≥1 resolves → ingest ingredients + compose one dish/meal → catalog_id │
        │  3. neither → MISS                                                       │
        └───────────────┬───────────────────────────────┬────────────────────────┘
              hit: replace ref                miss: re-invoke MealSuggestSlot
              with { type:"catalog", id }     constrained to existing items only
```

On a **TheMealDB hit**, the *provider's* recipe is ingested (its canonical name
and ingredient list), which may differ slightly from what the LLM imagined.
This is the accepted price of authoritative nutrition data.

The agent prompt for `suggest_slot_meal` and `rebalance_meal_plan` is updated to
say: *prefer a catalog or user-library match; invent a meal (`type: "new"`) only
when nothing fits, and supply inferred ingredients with estimated macros.*

## Components

### a. Data layer — `plnd_data`

Extend `CatalogIngestRepository` (`plnd_data/src/repository/catalog_ingest.rs`)
and its PG implementation:

- `ingest_dish(IngestDishInput) -> Uuid` — upsert `catalog_dishes` on the
  `uq_dish_external` constraint; link `catalog_dish_ingredients` by ingredient
  id. Mirrors `plnd_seed::dishes::insert_dishes` (the reference implementation),
  but lives in production storage to satisfy the isolation rule.
- `ingest_meal(IngestMealInput) -> Uuid` — promote the existing `#[cfg(test)]`
  `ingest_meal` free function to production; upsert `catalog_meals`, link
  `catalog_meal_dishes`.
- For LLM-composed (non-recipe) meals with no provider `external_id`: attribute
  via `contributed_by_user_id` and a synthetic `external_source = "llm_composed"`
  with a deterministic `external_id` (e.g. a slug/hash of the normalised name) so
  concurrent or repeat promotions dedup via `ON CONFLICT`.

All ingest methods are idempotent via `ON CONFLICT DO NOTHING/UPDATE` on the
existing named unique constraints.

### b. Promotion service — `plnd_api` (new module `meal_promotion.rs`)

Pure orchestration; contains **no SQL**. Given a `new` meal proposal, it:

1. Searches TheMealDB by name (via the recipe provider trait /
   `ProviderSearchService`); on a confident hit, fetches the full dish by id and
   ingests meal + dishes + ingredients through `CatalogIngestRepository`.
2. Otherwise resolves each `inferred_ingredient` against the nutrition providers
   (USDA FDC / Open Food Facts), ingests the ones that resolve, and composes a
   single dish + meal with aggregated nutrition.
3. Returns `Promoted(catalog_meal_id)` or `Missed`.

Lives in `plnd_api` because it coordinates external providers *and* repositories
— matching the existing `/search/*` handler pattern, and keeping `plnd_agent`
unaware of providers/storage.

### c. Agent surface — `plnd_agent`

Schema + prompt changes only; the terminal tools remain echo-only (no DB writes):

- Add a `new` variant to the `meal_ref` shape in the `suggest_slot_meal` and
  `rebalance_meal_plan` tool schemas, carrying `name`, `occasion_tags`,
  `inferred_ingredients[] { name, grams }`, and `estimated_nutrition`.
- Update `MEAL_SUGGEST_SLOT_PROMPT` and `MEAL_REBALANCE_PROMPT` to describe when
  and how to invent a meal.
- Add a "constrained" mode signal (context flag) so a re-invocation can instruct
  the agent to choose **only** existing catalog/user items (no `new`).

### d. Orchestration — `plnd_api/src/routes/agent.rs`

Wire interception + miss-driven re-invoke into all three entry points:

- `post_meal_plan` — per-slot parallel fan-out; promote each `new` ref after its
  slot resolves.
- `post_meal_plan_rebalance` — loop over the returned week envelope; promote each
  `new` ref.
- single `suggest_slot` route — promote the one ref.

Re-invocation reuses the existing `build_suggest_slot_ctx(... avoid_list)`
machinery already used by the review pass (`agent.rs:860-863`); the only new
inputs are the *provider-miss* trigger and the *existing-only* constraint flag.

## Error handling & edge cases

- **Provider timeout / error** → treated as a miss (graceful), the same way the
  `/search/*` handlers swallow `ProviderSearchEvent::Error`.
- **Partial ingredient resolution** → if ≥1 inferred ingredient resolves, it is a
  hit: compose with what resolved and flag the meal nutrition as estimated for the
  gaps. Only zero resolution counts as a miss.
- **Re-invoke still returns `new`** → cap at one constrained retry; if it still
  refuses to pick an existing item, the slot lands in `failed_slots` (existing
  behaviour — no regression).
- **Concurrent duplicate inventions** → `ON CONFLICT` on the external-key unique
  constraints makes promotion idempotent across the parallel slot fan-out.
- **Rate limiting** → promotion adds no agent calls on the hit path; the miss
  path's re-invocation is a normal `MealSuggestSlot` call already covered by the
  existing outer rate-limit guard.

## Testing

- **Unit (`plnd_data`)** — `sqlx::test` coverage for `ingest_dish` / `ingest_meal`
  (insert + idempotent re-ingest + dish/ingredient linking).
- **Unit (`plnd_api`)** — promotion service against the fixture-backed providers:
  recipe hit, ingredient-only hit, partial resolution, and full miss.
- **Unit (`plnd_agent`)** — terminal-tool schemas accept the `new` variant and
  still reject malformed refs.
- **E2E (`plnd_client/e2e`)** — under `just verify` the fixture providers
  (TheMealDB, USDA, OFF) are already live; a wizard run forced into a novel slot
  should land a new `catalog_meals` row. Honors the e2e policy: real backend,
  only the LLM is mockable.

## Out of scope

- Background/asynchronous promotion (depends on Phase 3.5 background-agent jobs).
- A user-facing browse/curation surface for LLM-composed catalog meals.
- Changing how `resolve_meal_description`'s adhoc `new` branch works (it still
  creates a `user_meal`); this design targets the planning wizard surfaces.
- Provider-verification gating of `llm_composed` visibility (revisit after
  observing real data).
