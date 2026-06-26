use std::sync::Arc;

use plnd_data::cache::SearchCache;
#[cfg(debug_assertions)]
use plnd_data::providers::{
    FixtureNewsProvider, FixtureNutritionProvider, FixtureWeatherProvider, TheMealDbFixtureProvider,
};
use plnd_data::providers::{
    NewsProvider, OpenFoodFactsProvider, OpenMeteoProvider, RssFeedProvider, TheMealDbProvider,
    UsdaFdcProvider, WeatherProvider,
};
use plnd_data::search::ProviderSearchService;

use plnd_api::briefing::BriefingState;

pub struct Providers {
    pub search: ProviderSearchService,
    pub briefing: BriefingState,
    pub brand_normalizer: Arc<dyn plnd_agent::BrandNormalizer>,
    /// Recipe providers reused by the background catalog seed task (Task 3).
    pub catalog_recipe: Vec<Arc<dyn plnd_data::providers::RecipeProvider>>,
}

pub fn build(
    external: &plnd_api::config::settings::ExternalProvidersConfig,
    llm: &plnd_agent::LlmConfig,
) -> Providers {
    // Construct external providers (moved verbatim from old main.rs:148-174).
    let nutrition_usda: Arc<dyn plnd_data::providers::NutritionProvider> =
        Arc::new(UsdaFdcProvider::new(&external.usda_fdc_api_key));
    let off_basic_auth = if external.off_basic_auth_user.is_empty() {
        None
    } else {
        Some((
            external.off_basic_auth_user.clone(),
            external.off_basic_auth_password.clone(),
        ))
    };
    let nutrition_off: Arc<dyn plnd_data::providers::NutritionProvider> = Arc::new(
        OpenFoodFactsProvider::new(&external.off_base_url, off_basic_auth),
    );
    let recipe_mdb = Arc::new(TheMealDbProvider::new(&external.themealdb_api_key));

    if external.usda_fdc_api_key.is_empty() {
        tracing::warn!(
            "USDA FDC provider: no API key set (will return ConfigurationError at runtime)"
        );
    } else {
        tracing::info!("USDA FDC provider: ready");
    }
    tracing::info!(base_url = %external.off_base_url, "Open Food Facts provider: ready");
    tracing::info!("TheMealDB provider: ready");

    let catalog_nutrition =
        build_nutrition_providers(external, nutrition_usda.clone(), nutrition_off.clone());
    let catalog_recipe = build_recipe_providers(external, recipe_mdb.clone());

    let search_cache = SearchCache::new(external.search_cache_ttl_hours);
    let search = ProviderSearchService::new(
        catalog_nutrition,
        catalog_recipe.clone(),
        vec![],
        search_cache,
    );

    let (weather_provider, news_provider) = build_briefing_providers(external);
    let briefing = BriefingState::new(weather_provider, news_provider);
    if external.fixture_path.is_none() {
        if external.news_feed_urls.is_empty() {
            tracing::warn!("briefing news feed disabled (news_feed_urls not set)");
        } else {
            tracing::info!(
                feed_count = external.news_feed_urls.len(),
                "briefing news feeds configured"
            );
        }
    }

    let brand_normalizer = build_brand_normalizer(external, llm);

    Providers {
        search,
        briefing,
        brand_normalizer,
        catalog_recipe,
    }
}

/// Constructs the weather + news providers for the briefing handlers.
///
/// In debug builds, if `external.fixture_path` is set, returns file-backed
/// implementations that read captured upstream responses from disk — used by
/// e2e to keep tests deterministic and offline. Otherwise (and always in
/// release builds, where the fixture impls do not exist) returns the real
/// Open-Meteo + RSS providers.
fn build_briefing_providers(
    external: &plnd_api::config::settings::ExternalProvidersConfig,
) -> (Arc<dyn WeatherProvider>, Arc<dyn NewsProvider>) {
    #[cfg(debug_assertions)]
    if let Some(fixture_root) = &external.fixture_path {
        tracing::warn!(
            path = %fixture_root.display(),
            "USING FIXTURE PROVIDERS for /briefing/* — debug builds only; never enable in prod"
        );
        let weather_path = fixture_root.join("open-meteo/forecast.json");
        let weather = FixtureWeatherProvider::new(weather_path).unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to load fixture weather provider");
            std::process::exit(1);
        });
        let rss_dir = fixture_root.join("rss");
        let feed_paths: Vec<std::path::PathBuf> = std::fs::read_dir(&rss_dir)
            .unwrap_or_else(|e| {
                tracing::error!(path = %rss_dir.display(), error = %e, "failed to read fixture rss dir");
                std::process::exit(1);
            })
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("xml"))
            .collect();
        let news = FixtureNewsProvider::new(feed_paths).unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to load fixture news provider");
            std::process::exit(1);
        });
        return (Arc::new(weather), Arc::new(news));
    }

    (
        Arc::new(OpenMeteoProvider::new()),
        Arc::new(RssFeedProvider::new(&external.news_feed_urls)),
    )
}

/// Constructs the nutrition providers for the search service.
///
/// In debug builds, if `external.fixture_path` is set, returns file-backed
/// implementations that replay captured search results from disk — used by
/// e2e to keep tests deterministic and offline. Otherwise (and always in
/// release builds) returns the real USDA FDC + Open Food Facts providers.
///
/// The live providers are passed in rather than constructed here because they
/// are also used by the catalog seed task running concurrently.
fn build_nutrition_providers(
    external: &plnd_api::config::settings::ExternalProvidersConfig,
    usda: Arc<dyn plnd_data::providers::NutritionProvider>,
    off: Arc<dyn plnd_data::providers::NutritionProvider>,
) -> Vec<Arc<dyn plnd_data::providers::NutritionProvider>> {
    #[cfg(debug_assertions)]
    if let Some(fixture_root) = &external.fixture_path {
        tracing::warn!(
            path = %fixture_root.display(),
            "USING FIXTURE NUTRITION PROVIDERS for catalog seed + /search/ingredients — debug builds only; never enable in prod"
        );
        let make = |source: &str, dir: &str| {
            let search_path = fixture_root.join(dir).join("search.json");
            let lookup_path = fixture_root.join(dir).join("lookup.json");
            FixtureNutritionProvider::new(source.to_string(), search_path, lookup_path)
                .unwrap_or_else(|e| {
                    tracing::error!(error = %e, "failed to load nutrition fixture");
                    std::process::exit(1);
                })
        };
        // USDA canonical foods are seeded from the vendored corpus (local hits),
        // so the debug fan-out only needs the Open Food Facts branded lane.
        return vec![Arc::new(make("openfoodfacts", "nutrition/open_food_facts"))];
    }
    vec![usda, off]
}

/// Constructs the recipe providers for the catalog seed + search service.
///
/// In debug builds, if `external.fixture_path` is set, returns file-backed
/// implementations that replay captured search + lookup results from disk —
/// used by e2e to keep tests deterministic and offline. Otherwise (and always
/// in release builds) returns the real TheMealDB provider.
fn build_recipe_providers(
    external: &plnd_api::config::settings::ExternalProvidersConfig,
    mdb: Arc<dyn plnd_data::providers::RecipeProvider>,
) -> Vec<Arc<dyn plnd_data::providers::RecipeProvider>> {
    #[cfg(debug_assertions)]
    if let Some(fixture_root) = &external.fixture_path {
        tracing::warn!(
            path = %fixture_root.display(),
            "USING FIXTURE RECIPE PROVIDERS for catalog seed + /search/dishes — debug builds only; never enable in prod"
        );
        let search_path = fixture_root.join("recipe/themealdb/search.json");
        let lookup_path = fixture_root.join("recipe/themealdb/lookup.json");
        let provider =
            TheMealDbFixtureProvider::new(search_path, lookup_path).unwrap_or_else(|e| {
                tracing::error!(error = %e, "failed to load recipe fixture");
                std::process::exit(1);
            });
        return vec![Arc::new(provider)];
    }
    vec![mdb]
}

/// Constructs the brand normalizer for the promote path (#913).
///
/// In debug builds, if `external.fixture_path` is set, returns the file-backed
/// `FixtureBrandNormalizer` (deterministic, offline) so e2e never makes a live
/// LLM call. Otherwise (and always in release builds) returns the LLM-backed
/// normalizer using the fast-tier provider.
fn build_brand_normalizer(
    external: &plnd_api::config::settings::ExternalProvidersConfig,
    llm: &plnd_agent::LlmConfig,
) -> Arc<dyn plnd_agent::BrandNormalizer> {
    #[cfg(debug_assertions)]
    if let Some(fixture_root) = &external.fixture_path {
        tracing::warn!(
            path = %fixture_root.display(),
            "USING FIXTURE BRAND NORMALIZER for /catalog/ingredients/promote — debug builds only; never enable in prod"
        );
        let path = fixture_root.join("brand_normalization.json");
        let normalizer = plnd_agent::FixtureBrandNormalizer::from_path(&path).unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to load brand-normalization fixture");
            std::process::exit(1);
        });
        return Arc::new(normalizer);
    }
    let provider = Arc::from(plnd_agent::build_fast_provider(llm));
    Arc::new(plnd_agent::LlmBrandNormalizer::new(provider))
}
