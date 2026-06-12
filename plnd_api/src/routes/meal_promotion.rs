//! Promotion of LLM-invented meals into the shared catalog.
//!
//! After an agent run, a `meal_ref` may be `{ "type": "new", … }`. This module
//! resolves that proposal against the provider detail-fetch surface and ingests
//! it into `catalog_meals` → `catalog_dishes` → `catalog_ingredients`, returning
//! a concrete catalog meal_ref. On a provider miss it returns `Missed` so the
//! caller can re-invoke the agent constrained to existing items.

use serde::Deserialize;
use uuid::Uuid;

use plnd_data::repository::CatalogIngestRepository;
use plnd_data::repository::catalog_ingest::{
    DishIngredientLinkInput, IngestDishInput, IngestIngredientInput, IngestMealInput,
    MealDishLinkInput,
};
use plnd_data::search::ProviderSearchService;
use rust_decimal::Decimal;

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
/// kept for use by `promote_new_meal`'s signature and the Task 9 tests.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RawMealRef {
    Catalog { id: Uuid },
    User { id: Uuid },
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
            RawMealRef::New { name, occasion_tags, inferred_ingredients } => {
                Some(NewMealProposal { name, occasion_tags, inferred_ingredients })
            }
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
    format!("llm-{}", slug.trim_matches('-'))
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
    user_id: Uuid,
    proposal: &NewMealProposal,
) -> PromotionOutcome {
    // ── Branch 1: recipe match ────────────────────────────────────────────────
    if let Some((source, dish)) = search.resolve_dish(&proposal.name).await {
        let mut links: Vec<DishIngredientLinkInput> = Vec::new();
        for (idx, di) in dish.ingredients.iter().enumerate() {
            if let Some((ing_source, ing)) = search.resolve_ingredient(&di.name).await {
                if let Ok(ingredient_id) = ingest
                    .ingest_ingredient(ingredient_input_from(&ing_source, &ing))
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
        let Ok(dish_id) = ingest
            .ingest_dish(IngestDishInput {
                external_source: source.clone(),
                external_id: dish.external_id.clone(),
                name: dish.name.clone(),
                description: None,
                instructions: None,
                servings: Decimal::from(1),
                allergens: vec![],
                occasion_tags: proposal.occasion_tags.clone(),
                nutrition: None,
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
            None,
        )
        .await;
    }

    // ── Branch 2: compose from inferred ingredients ──────────────────────────
    let mut links: Vec<DishIngredientLinkInput> = Vec::new();
    for (idx, inferred) in proposal.inferred_ingredients.iter().enumerate() {
        if let Some((ing_source, ing)) = search.resolve_ingredient(&inferred.name).await {
            if let Ok(ingredient_id) = ingest
                .ingest_ingredient(ingredient_input_from(&ing_source, &ing))
                .await
            {
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
            nutrition: None,
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
        Some(user_id),
    )
    .await
}

fn ingredient_input_from(
    source: &str,
    ing: &plnd_data::providers::dtos::ExternalIngredient,
) -> IngestIngredientInput {
    IngestIngredientInput {
        external_source: source.to_string(),
        external_id: ing.external_id.clone(),
        name: ing.name.clone(),
        description: None,
        serving_size_g: None,
        nutrition: ing.nutrition.as_ref().and_then(|n| serde_json::to_value(n).ok()),
        allergens: vec![],
        occasion_tags: vec![],
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
    contributed_by_user_id: Option<Uuid>,
) -> PromotionOutcome {
    match ingest
        .ingest_meal(IngestMealInput {
            external_source,
            external_id,
            name,
            description: None,
            servings: Decimal::from(1),
            allergens: vec![],
            occasion_tags: proposal.occasion_tags.clone(),
            tags: vec![],
            nutrition: None,
            contributed_by_user_id,
            dishes: vec![MealDishLinkInput {
                dish_id,
                dish_servings: Decimal::from(1),
                sort_order: 0,
            }],
        })
        .await
    {
        Ok(meal_id) => PromotionOutcome::Resolved { meal_type: "catalog".into(), id: meal_id },
        Err(_) => PromotionOutcome::Missed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Task 8: parse tests ───────────────────────────────────────────────────

    #[test]
    fn raw_meal_ref_parses_catalog() {
        let v = serde_json::json!({ "type": "catalog", "id": "00000000-0000-0000-0000-000000000001" });
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
            RawMealRef::New { name, inferred_ingredients, .. } => {
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
        let out = promote_new_meal(&svc, repo.as_ref(), Uuid::new_v4(), &proposal).await;
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
                occasion_tags: vec![],
            }))
        }
    }

    #[tokio::test]
    async fn promote_resolves_via_ingredient_composition() {
        let repo = Arc::new(CountingIngestRepo::default());
        let svc = ProviderSearchService::new(
            vec![Arc::new(TofuNutritionProvider)],
            vec![],  // no recipe providers → branch 1 skipped
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
        let out =
            promote_new_meal(&svc, repo.as_ref(), Uuid::new_v4(), &proposal).await;
        assert!(
            matches!(out, PromotionOutcome::Resolved { ref meal_type, .. } if meal_type == "catalog"),
            "expected Resolved, got {:?}",
            out
        );
        assert!(*repo.ingredients.lock().unwrap() >= 1, "expected ≥1 ingredient ingested");
        assert_eq!(*repo.dishes.lock().unwrap(), 1, "expected exactly 1 dish ingested");
        assert_eq!(*repo.meals.lock().unwrap(), 1, "expected exactly 1 meal ingested");
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
        let out = promote_new_meal(&svc, repo.as_ref(), Uuid::new_v4(), &proposal).await;
        assert!(
            matches!(out, PromotionOutcome::Resolved { ref meal_type, .. } if meal_type == "catalog"),
            "expected Resolved, got {:?}",
            out
        );
        assert!(*repo.ingredients.lock().unwrap() >= 1, "expected ≥1 ingredient ingested");
        assert_eq!(*repo.dishes.lock().unwrap(), 1, "expected exactly 1 dish ingested");
        assert_eq!(*repo.meals.lock().unwrap(), 1, "expected exactly 1 meal ingested");
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
            self.dishes
                .lock()
                .unwrap()
                .push((i.external_source.clone(), i.external_id.clone(), i.name.clone()));
            Ok(Uuid::new_v4())
        }
        async fn ingest_meal(&self, i: IngestMealInput) -> Result<Uuid, plnd_data::Error> {
            self.meals
                .lock()
                .unwrap()
                .push((i.external_source.clone(), i.external_id.clone(), i.name.clone()));
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
        let nutrition = FixtureNutritionProvider::new(
            "usda_fdc",
            PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../plnd_data/fixtures/nutrition/usda_fdc/search.json"
            )),
            PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../plnd_data/fixtures/nutrition/usda_fdc/lookup.json"
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

        let outcome = promote_new_meal(&svc, &repo, Uuid::new_v4(), &proposal).await;

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
        assert_eq!(dishes[0].1, "52795", "dish external_id = the TheMealDB recipe id");
        assert_eq!(meals[0].0, "themealdb", "meal external_source");
        assert_eq!(meals[0].1, "52795", "meal external_id");
    }
}
