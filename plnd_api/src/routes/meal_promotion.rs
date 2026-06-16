//! Promotion of LLM-invented meals into the shared catalog.
//!
//! After an agent run, a `meal_ref` may be `{ "type": "new", … }`. This module
//! resolves that proposal against the provider detail-fetch surface and ingests
//! it into `catalog_meals` → `catalog_dishes` → `catalog_ingredients`, returning
//! a concrete catalog meal_ref. On a provider miss it returns `Missed` so the
//! caller can re-invoke the agent constrained to existing items.

use serde::Deserialize;
use uuid::Uuid;

use crate::routes::catalog_ingest::resolve_name_brand;

use plnd_data::providers::dtos::NutritionFacts;
use plnd_data::repository::CatalogIngestRepository;
use plnd_data::repository::catalog_ingest::{
    DishIngredientLinkInput, IngestDishInput, IngestIngredientInput, IngestMealInput,
    MealDishLinkInput,
};
use plnd_data::search::ProviderSearchService;
use rust_decimal::Decimal;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
pub struct InferredIngredient {
    pub name: String,
    pub grams: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewMealProposal {
    pub name: String,
    #[serde(default)]
    pub occasion_tags: Vec<String>,
    pub inferred_ingredients: Vec<InferredIngredient>,
}

/// Raw `meal_ref` straight off the agent — either an existing ref or a `new` proposal.
///
/// Note: serde's internally-tagged representation does not support newtype tuple
/// variants that wrap structs, so the `New` variant uses an inline struct form
/// rather than `New(NewMealProposal)`. The standalone `NewMealProposal` struct is
/// kept for use by `promote_new_meal`'s signature and its tests.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RawMealRef {
    Catalog {
        id: Uuid,
    },
    User {
        id: Uuid,
    },
    New {
        name: String,
        #[serde(default)]
        occasion_tags: Vec<String>,
        inferred_ingredients: Vec<InferredIngredient>,
    },
}

impl RawMealRef {
    /// Extract a `NewMealProposal` if this is a `New` variant.
    pub fn into_new_proposal(self) -> Option<NewMealProposal> {
        match self {
            RawMealRef::New {
                name,
                occasion_tags,
                inferred_ingredients,
            } => Some(NewMealProposal {
                name,
                occasion_tags,
                inferred_ingredients,
            }),
            _ => None,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum PromotionOutcome {
    /// Existing ref passed through, or a `new` proposal successfully promoted.
    Resolved { meal_type: String, id: Uuid },
    /// Providers had nothing — caller should re-invoke constrained to existing.
    Missed,
}

/// Deterministic external_id for an LLM-composed (non-recipe) meal so concurrent
/// or repeat promotions of the same invented name dedup via ON CONFLICT.
///
/// The slug is intentionally lossy: distinct names sharing the same alphanumeric
/// content (e.g. "a  b" and "a-b") collapse to the same key, which is the desired
/// dedup behavior. Runs of separators are coalesced to a single `-`.
///
/// The slug is truncated so the full `llm-` + slug stays within the
/// `catalog_*.external_id` VARCHAR(100) column limit (migration 0012).
fn llm_composed_external_id(name: &str) -> String {
    let mut slug = String::new();
    let mut prev_sep = false;
    for c in name.to_lowercase().chars() {
        if c.is_alphanumeric() {
            slug.push(c);
            prev_sep = false;
        } else if !prev_sep {
            slug.push('-');
            prev_sep = true;
        }
    }
    // "llm-" prefix is 4 chars; cap the slug at 96 so the column's 100-char limit holds.
    let trimmed = slug.trim_matches('-');
    let capped: String = trimmed.chars().take(96).collect();
    format!("llm-{capped}")
}

/// Promote a `new` meal proposal into the shared catalog.
///
/// Strategy ("both — recipe then ingredients"):
/// 1. Search recipe providers (TheMealDB) by name; on a hit, ingest the recipe
///    as a catalog dish (resolvable ingredients linked) wrapped in a catalog meal.
/// 2. Otherwise resolve the LLM's inferred ingredients against the nutrition
///    providers; if ≥1 resolves, compose one dish + meal from them.
/// 3. If neither yields anything, return `Missed`.
pub async fn promote_new_meal(
    search: &ProviderSearchService,
    ingest: &dyn CatalogIngestRepository,
    normalizer: &dyn plnd_agent::BrandNormalizer,
    user_id: Uuid,
    proposal: &NewMealProposal,
) -> PromotionOutcome {
    // ── Branch 1: recipe match ────────────────────────────────────────────────
    if let Some((source, dish)) = search.resolve_dish(&proposal.name).await {
        let mut links: Vec<DishIngredientLinkInput> = Vec::new();
        for (idx, di) in dish.ingredients.iter().enumerate() {
            if let Some((ing_source, ing)) = search.resolve_ingredient(&di.name).await {
                let is_canonical = search.is_canonical_source(&ing_source);
                let (name, brand) = resolve_name_brand(is_canonical, &ing.name, normalizer).await;
                if let Ok(ingredient_id) = ingest
                    .ingest_ingredient(ingredient_input_from(&ing_source, &ing, name, brand))
                    .await
                {
                    let quantity = if di.quantity.is_sign_positive() && !di.quantity.is_zero() {
                        di.quantity
                    } else {
                        Decimal::from(1)
                    };
                    let unit = if di.unit.trim().is_empty() {
                        "serving".to_string()
                    } else {
                        di.unit.clone()
                    };
                    links.push(DishIngredientLinkInput {
                        ingredient_id,
                        quantity,
                        unit,
                        preparation_note: None,
                        is_optional: false,
                        sort_order: idx as i16,
                    });
                }
            }
        }
        // Carry the provider's real recipe data onto the catalog row rather than
        // hardcoding defaults. `servings` is Copy so it can be reused below.
        // Recipe ingredient quantities arrive in provider units ("cup"/"serving"),
        // which aren't gram-scalable — so the dish's nutrition can only come from
        // the provider's own recipe-level figure, never an ingredient rollup (#903).
        let dish_servings = dish.servings;
        let dish_nutrition = dish
            .nutrition
            .as_ref()
            .and_then(|n| serde_json::to_value(n).ok());
        let Ok(dish_id) = ingest
            .ingest_dish(IngestDishInput {
                external_source: source.clone(),
                external_id: dish.external_id.clone(),
                name: dish.name.clone(),
                description: None,
                instructions: dish.instructions.clone(),
                servings: dish_servings,
                allergens: dish.allergens.clone(),
                occasion_tags: proposal.occasion_tags.clone(),
                nutrition: dish_nutrition.clone(),
                contributed_by_user_id: None,
                ingredients: links,
            })
            .await
        else {
            return PromotionOutcome::Missed;
        };
        return wrap_dish_in_meal(
            ingest,
            source,
            dish.external_id,
            dish.name,
            proposal,
            dish_id,
            dish_servings,
            dish_nutrition,
            None,
        )
        .await;
    }

    // ── Branch 2: compose from inferred ingredients ──────────────────────────
    // Each resolved ingredient's nutrition is reported per 100 g, and its inferred
    // quantity is in grams, so the dish total is Σ (facts × grams/100) — an exact,
    // unit-consistent rollup. Macros nobody reported stay absent (#903).
    let mut links: Vec<DishIngredientLinkInput> = Vec::new();
    let mut aggregated: Option<NutritionFacts> = None;
    for (idx, inferred) in proposal.inferred_ingredients.iter().enumerate() {
        if let Some((ing_source, ing)) = search.resolve_ingredient(&inferred.name).await {
            let is_canonical = search.is_canonical_source(&ing_source);
            let (name, brand) = resolve_name_brand(is_canonical, &ing.name, normalizer).await;
            if let Ok(ingredient_id) = ingest
                .ingest_ingredient(ingredient_input_from(&ing_source, &ing, name, brand))
                .await
            {
                if let Some(facts) = &ing.nutrition {
                    let scaled = facts.scaled(inferred.grams / 100.0);
                    aggregated = Some(match aggregated {
                        Some(acc) => acc.plus(&scaled),
                        None => scaled,
                    });
                }
                let quantity = Decimal::try_from(inferred.grams)
                    .ok()
                    .filter(|d| d.is_sign_positive() && !d.is_zero())
                    .unwrap_or_else(|| Decimal::from(1));
                links.push(DishIngredientLinkInput {
                    ingredient_id,
                    quantity,
                    unit: "g".into(),
                    preparation_note: None,
                    is_optional: false,
                    sort_order: idx as i16,
                });
            }
        }
    }

    if links.is_empty() {
        return PromotionOutcome::Missed;
    }

    let dish_nutrition = aggregated
        .as_ref()
        .and_then(|n| serde_json::to_value(n).ok());
    let ext_id = llm_composed_external_id(&proposal.name);
    let Ok(dish_id) = ingest
        .ingest_dish(IngestDishInput {
            external_source: "llm_composed".into(),
            external_id: ext_id.clone(),
            name: proposal.name.clone(),
            description: None,
            instructions: None,
            servings: Decimal::from(1),
            allergens: vec![],
            occasion_tags: proposal.occasion_tags.clone(),
            nutrition: dish_nutrition.clone(),
            contributed_by_user_id: Some(user_id),
            ingredients: links,
        })
        .await
    else {
        return PromotionOutcome::Missed;
    };

    wrap_dish_in_meal(
        ingest,
        "llm_composed".into(),
        ext_id,
        proposal.name.clone(),
        proposal,
        dish_id,
        Decimal::from(1),
        dish_nutrition,
        Some(user_id),
    )
    .await
}

fn ingredient_input_from(
    source: &str,
    ing: &plnd_data::providers::dtos::ExternalIngredient,
    name: String,
    brand: Option<String>,
) -> IngestIngredientInput {
    IngestIngredientInput {
        external_source: source.to_string(),
        external_id: ing.external_id.clone(),
        name,
        description: None,
        serving_size_g: None,
        nutrition: ing
            .nutrition
            .as_ref()
            .and_then(|n| serde_json::to_value(n).ok()),
        allergens: vec![],
        occasion_tags: vec![],
        brand,
    }
}

#[allow(clippy::too_many_arguments)]
async fn wrap_dish_in_meal(
    ingest: &dyn CatalogIngestRepository,
    external_source: String,
    external_id: String,
    name: String,
    proposal: &NewMealProposal,
    dish_id: Uuid,
    servings: Decimal,
    nutrition: Option<Value>,
    contributed_by_user_id: Option<Uuid>,
) -> PromotionOutcome {
    // Promotion always wraps exactly one dish at one serving, so the meal's
    // nutrition is just that dish's nutrition (#903).
    match ingest
        .ingest_meal(IngestMealInput {
            external_source,
            external_id,
            name,
            description: None,
            servings,
            allergens: vec![],
            occasion_tags: proposal.occasion_tags.clone(),
            tags: vec![],
            nutrition,
            contributed_by_user_id,
            dishes: vec![MealDishLinkInput {
                dish_id,
                dish_servings: Decimal::from(1),
                sort_order: 0,
            }],
        })
        .await
    {
        Ok(meal_id) => PromotionOutcome::Resolved {
            meal_type: "catalog".into(),
            id: meal_id,
        },
        Err(_) => PromotionOutcome::Missed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Task 8: parse tests ───────────────────────────────────────────────────

    #[test]
    fn raw_meal_ref_parses_catalog() {
        let v =
            serde_json::json!({ "type": "catalog", "id": "00000000-0000-0000-0000-000000000001" });
        let r: RawMealRef = serde_json::from_value(v).unwrap();
        assert!(matches!(r, RawMealRef::Catalog { .. }));
    }

    #[test]
    fn raw_meal_ref_parses_user() {
        let v = serde_json::json!({ "type": "user", "id": "00000000-0000-0000-0000-000000000002" });
        let r: RawMealRef = serde_json::from_value(v).unwrap();
        assert!(matches!(r, RawMealRef::User { .. }));
    }

    #[test]
    fn raw_meal_ref_parses_new() {
        let v = serde_json::json!({
            "type": "new",
            "name": "Spicy Peanut Tofu Bowl",
            "occasion_tags": ["dinner"],
            "inferred_ingredients": [{ "name": "tofu", "grams": 150.0 }]
        });
        let r: RawMealRef = serde_json::from_value(v).unwrap();
        match r {
            RawMealRef::New {
                name,
                inferred_ingredients,
                ..
            } => {
                assert_eq!(name, "Spicy Peanut Tofu Bowl");
                assert_eq!(inferred_ingredients.len(), 1);
            }
            _ => panic!("expected New"),
        }
    }

    // ── Task 9: promotion tests ───────────────────────────────────────────────

    use plnd_data::repository::catalog_ingest::{
        ContributeIngredientInput, IngestDishInput, IngestIngredientInput, IngestMealInput,
    };
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct CountingIngestRepo {
        ingredients: Mutex<u32>,
        dishes: Mutex<u32>,
        meals: Mutex<u32>,
    }

    #[async_trait::async_trait]
    impl CatalogIngestRepository for CountingIngestRepo {
        async fn ingest_ingredient(
            &self,
            _i: IngestIngredientInput,
        ) -> Result<Uuid, plnd_data::Error> {
            *self.ingredients.lock().unwrap() += 1;
            Ok(Uuid::new_v4())
        }
        async fn contribute_ingredient(
            &self,
            _i: ContributeIngredientInput,
        ) -> Result<Uuid, plnd_data::Error> {
            Ok(Uuid::new_v4())
        }
        async fn ingest_dish(&self, _i: IngestDishInput) -> Result<Uuid, plnd_data::Error> {
            *self.dishes.lock().unwrap() += 1;
            Ok(Uuid::new_v4())
        }
        async fn ingest_meal(&self, _i: IngestMealInput) -> Result<Uuid, plnd_data::Error> {
            *self.meals.lock().unwrap() += 1;
            Ok(Uuid::new_v4())
        }
    }

    /// A normalizer that returns `None` for every name, so the confidence gate
    /// keeps the original name and `brand: None` — used to hold existing
    /// promotion tests at their pre-#940 expectations.
    fn no_op_normalizer() -> plnd_agent::FixtureBrandNormalizer {
        plnd_agent::FixtureBrandNormalizer::from_entries(std::collections::HashMap::new())
    }

    fn empty_search_service() -> ProviderSearchService {
        // No providers → every resolve_* returns None → guaranteed miss.
        ProviderSearchService::new(
            vec![],
            vec![],
            vec![],
            plnd_data::cache::SearchCache::new(36),
        )
    }

    #[tokio::test]
    async fn promote_returns_missed_when_no_provider_resolves() {
        let repo: Arc<dyn CatalogIngestRepository> = Arc::new(CountingIngestRepo::default());
        let svc = empty_search_service();
        let proposal = NewMealProposal {
            name: "Imaginary Stew".into(),
            occasion_tags: vec!["dinner".into()],
            inferred_ingredients: vec![InferredIngredient {
                name: "moonbeams".into(),
                grams: 100.0,
            }],
        };
        let out = promote_new_meal(
            &svc,
            repo.as_ref(),
            &no_op_normalizer(),
            Uuid::new_v4(),
            &proposal,
        )
        .await;
        assert_eq!(out, PromotionOutcome::Missed);
    }

    // ── HIT path: ingredient-compose ─────────────────────────────────────────

    use plnd_data::providers::dtos::{
        ExternalDish, ExternalDishIngredient, ExternalIngredient, SearchQuery, SearchResult,
    };
    use plnd_data::providers::error::ExternalProviderError;
    use plnd_data::providers::nutrition::NutritionProvider;
    use plnd_data::providers::recipe::RecipeProvider;

    struct TofuNutritionProvider;

    #[async_trait::async_trait]
    impl NutritionProvider for TofuNutritionProvider {
        fn source_name(&self) -> &str {
            "test_nutrition"
        }
        async fn search_ingredients(
            &self,
            q: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            if q.query.to_lowercase().contains("tofu") {
                Ok(vec![SearchResult {
                    external_id: "tofu-1".into(),
                    name: "Firm Tofu".into(),
                    ..Default::default()
                }])
            } else {
                Ok(vec![])
            }
        }
        async fn get_ingredient_by_id(
            &self,
            id: &str,
        ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
            assert_eq!(id, "tofu-1");
            Ok(Some(ExternalIngredient {
                external_id: "tofu-1".into(),
                name: "Firm Tofu".into(),
                serving_size_g: None,
                nutrition: None,
                allergens: vec![],
            }))
        }
    }

    #[tokio::test]
    async fn promote_resolves_via_ingredient_composition() {
        let repo = Arc::new(CountingIngestRepo::default());
        let svc = ProviderSearchService::new(
            vec![Arc::new(TofuNutritionProvider)],
            vec![], // no recipe providers → branch 1 skipped
            vec![],
            plnd_data::cache::SearchCache::new(36),
        );
        let proposal = NewMealProposal {
            name: "Tofu Power Bowl".into(),
            occasion_tags: vec!["lunch".into()],
            inferred_ingredients: vec![InferredIngredient {
                name: "tofu".into(),
                grams: 150.0,
            }],
        };
        let out = promote_new_meal(
            &svc,
            repo.as_ref(),
            &no_op_normalizer(),
            Uuid::new_v4(),
            &proposal,
        )
        .await;
        assert!(
            matches!(out, PromotionOutcome::Resolved { ref meal_type, .. } if meal_type == "catalog"),
            "expected Resolved, got {:?}",
            out
        );
        assert!(
            *repo.ingredients.lock().unwrap() >= 1,
            "expected ≥1 ingredient ingested"
        );
        assert_eq!(
            *repo.dishes.lock().unwrap(),
            1,
            "expected exactly 1 dish ingested"
        );
        assert_eq!(
            *repo.meals.lock().unwrap(),
            1,
            "expected exactly 1 meal ingested"
        );
    }

    // ── HIT path: recipe match ───────────────────────────────────────────────

    struct TofuBowlRecipeProvider;

    #[async_trait::async_trait]
    impl RecipeProvider for TofuBowlRecipeProvider {
        fn source_name(&self) -> &str {
            "test_recipe"
        }
        async fn search_dishes(
            &self,
            q: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            if q.query.to_lowercase().contains("tofu") {
                Ok(vec![SearchResult {
                    external_id: "dish-1".into(),
                    name: "Tofu Power Bowl".into(),
                    ..Default::default()
                }])
            } else {
                Ok(vec![])
            }
        }
        async fn get_dish_by_id(
            &self,
            id: &str,
        ) -> Result<Option<ExternalDish>, ExternalProviderError> {
            assert_eq!(id, "dish-1");
            Ok(Some(ExternalDish {
                external_id: "dish-1".into(),
                name: "Tofu Power Bowl".into(),
                ingredients: vec![ExternalDishIngredient {
                    name: "tofu".into(),
                    quantity: Decimal::from(2),
                    unit: "cup".into(),
                    ..Default::default()
                }],
                ..Default::default()
            }))
        }
    }

    #[tokio::test]
    async fn promote_resolves_via_recipe_match() {
        let repo = Arc::new(CountingIngestRepo::default());
        let svc = ProviderSearchService::new(
            vec![Arc::new(TofuNutritionProvider)],
            vec![Arc::new(TofuBowlRecipeProvider)],
            vec![],
            plnd_data::cache::SearchCache::new(36),
        );
        let proposal = NewMealProposal {
            name: "Tofu Power Bowl".into(),
            occasion_tags: vec!["dinner".into()],
            inferred_ingredients: vec![InferredIngredient {
                name: "tofu".into(),
                grams: 150.0,
            }],
        };
        let out = promote_new_meal(
            &svc,
            repo.as_ref(),
            &no_op_normalizer(),
            Uuid::new_v4(),
            &proposal,
        )
        .await;
        assert!(
            matches!(out, PromotionOutcome::Resolved { ref meal_type, .. } if meal_type == "catalog"),
            "expected Resolved, got {:?}",
            out
        );
        assert!(
            *repo.ingredients.lock().unwrap() >= 1,
            "expected ≥1 ingredient ingested"
        );
        assert_eq!(
            *repo.dishes.lock().unwrap(),
            1,
            "expected exactly 1 dish ingested"
        );
        assert_eq!(
            *repo.meals.lock().unwrap(),
            1,
            "expected exactly 1 meal ingested"
        );
    }

    // ── Task 13: integration test over real captured provider fixtures ────────

    #[derive(Default)]
    struct RecordingIngestRepo {
        // (external_source, external_id, name) of each ingest_dish / ingest_meal call
        dishes: Mutex<Vec<(String, String, String)>>,
        meals: Mutex<Vec<(String, String, String)>>,
    }

    #[async_trait::async_trait]
    impl CatalogIngestRepository for RecordingIngestRepo {
        async fn ingest_ingredient(
            &self,
            _i: IngestIngredientInput,
        ) -> Result<Uuid, plnd_data::Error> {
            Ok(Uuid::new_v4())
        }
        async fn contribute_ingredient(
            &self,
            _i: ContributeIngredientInput,
        ) -> Result<Uuid, plnd_data::Error> {
            Ok(Uuid::new_v4())
        }
        async fn ingest_dish(&self, i: IngestDishInput) -> Result<Uuid, plnd_data::Error> {
            self.dishes.lock().unwrap().push((
                i.external_source.clone(),
                i.external_id.clone(),
                i.name.clone(),
            ));
            Ok(Uuid::new_v4())
        }
        async fn ingest_meal(&self, i: IngestMealInput) -> Result<Uuid, plnd_data::Error> {
            self.meals.lock().unwrap().push((
                i.external_source.clone(),
                i.external_id.clone(),
                i.name.clone(),
            ));
            Ok(Uuid::new_v4())
        }
    }

    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn promote_ingests_real_themealdb_fixture_recipe() {
        use plnd_data::providers::{FixtureNutritionProvider, TheMealDbFixtureProvider};
        use std::path::PathBuf;

        // TheMealDbFixtureProvider understands the raw TheMealDB JSON format used
        // in the captured fixtures (idMeal / strMeal / strIngredient1-20 etc.).
        // FixtureRecipeProvider expects pre-translated ExternalDish JSON, which is
        // a different schema — so we must use TheMealDbFixtureProvider here.
        let recipe = TheMealDbFixtureProvider::new(
            PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../plnd_data/fixtures/recipe/themealdb/search.json"
            )),
            PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../plnd_data/fixtures/recipe/themealdb/lookup.json"
            )),
        )
        .unwrap();
        // USDA fixture files were removed; the corpus seeds USDA canonical foods
        // directly. Use the Open Food Facts fixture for the nutrition lane —
        // this test only exercises the recipe (TheMealDB) branch so the choice
        // of nutrition provider does not affect the outcome.
        let nutrition = FixtureNutritionProvider::new(
            "openfoodfacts",
            PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../plnd_data/fixtures/nutrition/open_food_facts/search.json"
            )),
            PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../plnd_data/fixtures/nutrition/open_food_facts/lookup.json"
            )),
        )
        .unwrap();

        let svc = ProviderSearchService::new(
            vec![Arc::new(nutrition)],
            vec![Arc::new(recipe)],
            vec![],
            plnd_data::cache::SearchCache::new(36),
        );
        let repo = RecordingIngestRepo::default();

        let proposal = NewMealProposal {
            name: "chicken".into(),
            occasion_tags: vec!["dinner".into()],
            inferred_ingredients: vec![],
        };

        let outcome =
            promote_new_meal(&svc, &repo, &no_op_normalizer(), Uuid::new_v4(), &proposal).await;

        // The TheMealDB fixture resolves "chicken" → "Chicken Handi" (id 52795),
        // so promotion takes the recipe branch and ingests a catalog dish + meal
        // keyed to the real provider source/id.
        assert!(
            matches!(&outcome, PromotionOutcome::Resolved { meal_type, .. } if meal_type == "catalog"),
            "expected catalog Resolved, got {outcome:?}"
        );
        let dishes = repo.dishes.lock().unwrap();
        let meals = repo.meals.lock().unwrap();
        assert_eq!(dishes.len(), 1, "exactly one dish ingested");
        assert_eq!(meals.len(), 1, "exactly one meal ingested");
        assert_eq!(dishes[0].0, "themealdb", "dish external_source");
        assert_eq!(
            dishes[0].1, "52795",
            "dish external_id = the TheMealDB recipe id"
        );
        assert_eq!(meals[0].0, "themealdb", "meal external_source");
        assert_eq!(meals[0].1, "52795", "meal external_id");
    }

    // ── Nutrition aggregation / propagation (#903) ───────────────────────────

    use plnd_data::providers::dtos::NutritionFacts;

    /// Records the `nutrition` JSONB passed to the latest ingest_dish / ingest_meal.
    #[derive(Default)]
    struct NutritionRecordingIngestRepo {
        dish_nutrition: Mutex<Option<serde_json::Value>>,
        meal_nutrition: Mutex<Option<serde_json::Value>>,
    }

    #[async_trait::async_trait]
    impl CatalogIngestRepository for NutritionRecordingIngestRepo {
        async fn ingest_ingredient(
            &self,
            _i: IngestIngredientInput,
        ) -> Result<Uuid, plnd_data::Error> {
            Ok(Uuid::new_v4())
        }
        async fn contribute_ingredient(
            &self,
            _i: ContributeIngredientInput,
        ) -> Result<Uuid, plnd_data::Error> {
            Ok(Uuid::new_v4())
        }
        async fn ingest_dish(&self, i: IngestDishInput) -> Result<Uuid, plnd_data::Error> {
            *self.dish_nutrition.lock().unwrap() = i.nutrition.clone();
            Ok(Uuid::new_v4())
        }
        async fn ingest_meal(&self, i: IngestMealInput) -> Result<Uuid, plnd_data::Error> {
            *self.meal_nutrition.lock().unwrap() = i.nutrition.clone();
            Ok(Uuid::new_v4())
        }
    }

    /// A nutrition provider whose ingredient carries per-100g macros.
    struct NutritiousTofuProvider;

    #[async_trait::async_trait]
    impl NutritionProvider for NutritiousTofuProvider {
        fn source_name(&self) -> &str {
            "test_nutrition"
        }
        async fn search_ingredients(
            &self,
            q: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            if q.query.to_lowercase().contains("tofu") {
                Ok(vec![SearchResult {
                    external_id: "tofu-1".into(),
                    name: "Tofu".into(),
                    ..Default::default()
                }])
            } else {
                Ok(vec![])
            }
        }
        async fn get_ingredient_by_id(
            &self,
            _id: &str,
        ) -> Result<Option<ExternalIngredient>, ExternalProviderError> {
            Ok(Some(ExternalIngredient {
                external_id: "tofu-1".into(),
                name: "Tofu".into(),
                serving_size_g: None,
                // per-100g: 100 kcal, 10 g protein
                nutrition: Some(NutritionFacts {
                    calories_kcal: Some(100.0),
                    protein_g: Some(10.0),
                    ..Default::default()
                }),
                allergens: vec![],
            }))
        }
    }

    #[tokio::test]
    async fn promote_aggregates_ingredient_nutrition_scaled_by_grams() {
        let repo = NutritionRecordingIngestRepo::default();
        let svc = ProviderSearchService::new(
            vec![Arc::new(NutritiousTofuProvider)],
            vec![], // no recipe provider → ingredient-compose branch
            vec![],
            plnd_data::cache::SearchCache::new(36),
        );
        let proposal = NewMealProposal {
            name: "Tofu Bowl".into(),
            occasion_tags: vec!["lunch".into()],
            inferred_ingredients: vec![InferredIngredient {
                name: "tofu".into(),
                grams: 150.0,
            }],
        };

        let out =
            promote_new_meal(&svc, &repo, &no_op_normalizer(), Uuid::new_v4(), &proposal).await;
        assert!(
            matches!(out, PromotionOutcome::Resolved { .. }),
            "got {out:?}"
        );

        // 150 g of a per-100g (100 kcal, 10 g protein) ingredient → ×1.5.
        let dish: NutritionFacts = serde_json::from_value(
            repo.dish_nutrition
                .lock()
                .unwrap()
                .clone()
                .expect("dish nutrition set"),
        )
        .unwrap();
        assert_eq!(dish.calories_kcal, Some(150.0));
        assert_eq!(dish.protein_g, Some(15.0));

        // The meal wraps the single dish at 1 serving → identical nutrition.
        let meal: NutritionFacts = serde_json::from_value(
            repo.meal_nutrition
                .lock()
                .unwrap()
                .clone()
                .expect("meal nutrition set"),
        )
        .unwrap();
        assert_eq!(meal.calories_kcal, Some(150.0));
        assert_eq!(meal.protein_g, Some(15.0));
    }

    /// A recipe provider whose dish carries its own nutrition.
    struct NutritiousRecipeProvider;

    #[async_trait::async_trait]
    impl RecipeProvider for NutritiousRecipeProvider {
        fn source_name(&self) -> &str {
            "test_recipe"
        }
        async fn search_dishes(
            &self,
            q: &SearchQuery,
        ) -> Result<Vec<SearchResult>, ExternalProviderError> {
            if q.query.to_lowercase().contains("soup") {
                Ok(vec![SearchResult {
                    external_id: "soup-1".into(),
                    name: "Tomato Soup".into(),
                    ..Default::default()
                }])
            } else {
                Ok(vec![])
            }
        }
        async fn get_dish_by_id(
            &self,
            _id: &str,
        ) -> Result<Option<ExternalDish>, ExternalProviderError> {
            Ok(Some(ExternalDish {
                external_id: "soup-1".into(),
                name: "Tomato Soup".into(),
                nutrition: Some(NutritionFacts {
                    calories_kcal: Some(400.0),
                    ..Default::default()
                }),
                ..Default::default()
            }))
        }
    }

    #[tokio::test]
    async fn promote_propagates_recipe_nutrition_to_meal() {
        let repo = NutritionRecordingIngestRepo::default();
        let svc = ProviderSearchService::new(
            vec![],
            vec![Arc::new(NutritiousRecipeProvider)],
            vec![],
            plnd_data::cache::SearchCache::new(36),
        );
        let proposal = NewMealProposal {
            name: "Tomato Soup".into(),
            occasion_tags: vec!["lunch".into()],
            inferred_ingredients: vec![],
        };

        let out =
            promote_new_meal(&svc, &repo, &no_op_normalizer(), Uuid::new_v4(), &proposal).await;
        assert!(
            matches!(out, PromotionOutcome::Resolved { .. }),
            "got {out:?}"
        );

        // The provider's dish nutrition must reach both the dish and the meal row.
        let dish: NutritionFacts = serde_json::from_value(
            repo.dish_nutrition
                .lock()
                .unwrap()
                .clone()
                .expect("dish nutrition set"),
        )
        .unwrap();
        assert_eq!(dish.calories_kcal, Some(400.0));
        let meal: NutritionFacts = serde_json::from_value(
            repo.meal_nutrition
                .lock()
                .unwrap()
                .clone()
                .expect("meal nutrition set"),
        )
        .unwrap();
        assert_eq!(meal.calories_kcal, Some(400.0));
    }
}
